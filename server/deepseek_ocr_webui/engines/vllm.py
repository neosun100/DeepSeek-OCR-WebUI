"""vLLM 推理引擎：OpenAI 兼容接口 → `vllm serve`（上游 vLLM ≥0.16 原生支持 DeepSeek-OCR-2）。

两种形态：
- **托管**（默认）：本服务启动一个只绑 127.0.0.1 的 vLLM 子进程，生命周期随本服务。
- **外部**（`DSOCR_VLLM_URLS=http://a:8000,http://b:8000`）：多个 vLLM 实例（多卡 / 多机，#32），按最少在途分配。

相对 HF 路径的收益是连续批处理（并发请求在 GPU 上合批）。参数按官方 recipe：
NGramPerReqLogitsProcessor 防复读（ngram 30 / window 90 / `<td>` `</td>` 白名单）、关 prefix cache 与 mm 缓存。

工程防护（aws-gpu Unlimited-OCR 的教训）：
- 流式接收，每 500 字检一次尾部复读，检出即 **关闭连接**（只停止读取的话 GPU 会继续白跑到 max_tokens）。
- SSE 里的 `{"error": …}` 当失败，不当空输出；流结束却没有 finish_reason ⇒ 后端失联。
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
from loguru import logger
from PIL import Image

from ..judges import repetition
from .base import Engine, EngineOOM, EngineUnavailable, RawOutput

SERVED_NAME = "deepseek-ocr-2"
LOGITS_PROCESSOR = "vllm.model_executor.models.deepseek_ocr:NGramPerReqLogitsProcessor"
NGRAM_ARGS = {"ngram_size": 30, "window_size": 90, "whitelist_token_ids": [128821, 128822]}
CUT_CHECK_EVERY_CHARS = 500
# 生成上限 8192 + 图像 token（全局 257 + 最多 6 块局部 × 144）+ 文本 ⇒ 10240 容得下
MANAGED_MAX_MODEL_LEN = 10240


class VLLMEngine(Engine):
    name = "vllm"

    def __init__(
        self,
        *,
        model_id: str,
        revision: str | None,
        model_path: str | None,
        urls: list[str],
        port: int,
        gpu_memory_utilization: float,
        max_concurrency: int,
        extra_args: str,
        start_timeout_s: float,
        request_timeout_s: float,
        log_dir: str | None,
    ) -> None:
        self.model_id = model_id
        self.revision = revision
        self.model_path = model_path
        self.managed = not urls
        self.urls = [u.rstrip("/") for u in urls] or [f"http://127.0.0.1:{port}"]
        self.port = port
        self.gpu_memory_utilization = gpu_memory_utilization
        self.max_concurrency = max_concurrency * len(self.urls)
        self.extra_args = extra_args
        self.start_timeout_s = start_timeout_s
        self.request_timeout_s = request_timeout_s
        self.log_dir = log_dir
        self._inflight = {u: 0 for u in self.urls}
        self._proc: subprocess.Popen[bytes] | None = None
        self._client: httpx.AsyncClient | None = None
        self._served_model: str = SERVED_NAME
        self._version: str | None = None

    # ------------------------------------------------------------------ load
    def _command(self) -> list[str]:
        cmd = [
            sys.executable, "-m", "vllm.entrypoints.openai.api_server",
            "--model", self.model_path or self.model_id,
            "--served-model-name", SERVED_NAME,
            "--host", "127.0.0.1",  # 子进程只绑本机：对外只有本服务这一个入口
            "--port", str(self.port),
            "--trust-remote-code",
            "--logits-processors", LOGITS_PROCESSOR,
            "--no-enable-prefix-caching",
            "--mm-processor-cache-gb", "0",
            "--gpu-memory-utilization", str(self.gpu_memory_utilization),
            "--max-model-len", str(MANAGED_MAX_MODEL_LEN),
            "--max-num-seqs", str(self.max_concurrency),
        ]  # fmt: skip
        if self.revision and not self.model_path:
            cmd += ["--revision", self.revision, "--tokenizer-revision", self.revision]
        cmd += shlex.split(self.extra_args)
        return cmd

    async def load(self) -> None:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(self.request_timeout_s, connect=10.0))
        if self.managed:
            await self._start_subprocess()
        await self._wait_ready()
        await self._discover_model()

    async def _start_subprocess(self) -> None:
        cmd = self._command()
        log_path = Path(self.log_dir or tempfile.gettempdir()) / "vllm-server.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        logger.info("启动 vLLM 子进程（日志 {}）：{}", log_path, " ".join(cmd))
        log_f = open(log_path, "ab")  # noqa: SIM115 —— 文件句柄随子进程生命周期，由 close() 关闭
        env = dict(os.environ)
        # 命令行全部来自部署配置（Settings），不含任何请求数据
        self._proc = subprocess.Popen(  # noqa: S603
            cmd, stdout=log_f, stderr=subprocess.STDOUT, env=env, start_new_session=True
        )
        self._log_path = log_path

    def _log_tail(self, n: int = 30) -> str:
        try:
            lines = Path(self._log_path).read_text(errors="replace").splitlines()
            return "\n".join(lines[-n:])
        except (OSError, AttributeError):
            return "(无 vLLM 日志)"

    async def _wait_ready(self) -> None:
        assert self._client is not None
        deadline = time.monotonic() + self.start_timeout_s
        pending = set(self.urls)
        while pending:
            if self._proc is not None and self._proc.poll() is not None:
                raise EngineUnavailable(
                    f"vLLM 子进程退出（code={self._proc.returncode}）。日志末尾：\n{self._log_tail()}"
                )
            for u in list(pending):
                try:
                    r = await self._client.get(f"{u}/health", timeout=5.0)
                    if r.status_code == 200:
                        pending.discard(u)
                        logger.info("vLLM 就绪：{}", u)
                except httpx.HTTPError:
                    pass
            if pending and time.monotonic() > deadline:
                raise EngineUnavailable(f"vLLM 在 {self.start_timeout_s:.0f}s 内未就绪：{sorted(pending)}")
            if pending:
                await asyncio.sleep(2.0)

    async def _discover_model(self) -> None:
        """外部 vLLM 的 served-model-name 未必是我们的名字 ⇒ 读 /v1/models 取第一个。"""
        assert self._client is not None
        try:
            r = await self._client.get(f"{self.urls[0]}/v1/models")
            r.raise_for_status()
            data = r.json().get("data") or []
            if data:
                self._served_model = data[0]["id"]
            v = await self._client.get(f"{self.urls[0]}/version")
            if v.status_code == 200:
                self._version = v.json().get("version")
        except (httpx.HTTPError, ValueError, KeyError) as e:
            raise EngineUnavailable(f"读取 vLLM 模型列表失败：{e}") from e

    # --------------------------------------------------------------- infer
    def _pick_url(self) -> str:
        return min(self.urls, key=lambda u: self._inflight[u])

    @staticmethod
    def _encode(image: Image.Image) -> str:
        buf = io.BytesIO()
        image.save(buf, format="PNG")  # 无损：本机回环，带宽不是瓶颈
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    def _body(self, image: Image.Image, prompt: str, max_tokens: int | None) -> dict[str, Any]:
        text = prompt.split("<image>\n", 1)[-1]  # 图像由 content 里的 image_url 承载
        body: dict[str, Any] = {
            "model": self._served_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": self._encode(image)}},
                        {"type": "text", "text": text},
                    ],
                }
            ],
            "temperature": 0.0,
            "stream": True,
            "stream_options": {"include_usage": True},
            "skip_special_tokens": False,  # 保留 <|ref|>/<|det|> grounding 标记
            "vllm_xargs": NGRAM_ARGS,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return body

    async def infer(self, image: Image.Image, prompt: str, *, max_tokens: int) -> RawOutput:
        if self._client is None:
            raise EngineUnavailable("vLLM 引擎尚未加载")
        url = self._pick_url()
        self._inflight[url] += 1
        try:
            try:
                return await self._stream(url, self._body(image, prompt, max_tokens), max_tokens)
            except _ContextTooLong:
                # 外部 vLLM 的 max_model_len 可能更小：不指定 max_tokens，让 vLLM 用剩余上下文
                logger.warning("max_tokens={} 超出 {} 的上下文长度，改为由 vLLM 自定上限", max_tokens, url)
                return await self._stream(url, self._body(image, prompt, None), max_tokens)
        finally:
            self._inflight[url] -= 1

    async def _stream(self, url: str, body: dict[str, Any], max_tokens: int) -> RawOutput:
        assert self._client is not None
        t0 = time.monotonic()
        parts: list[str] = []
        n_chars = 0
        next_check = CUT_CHECK_EVERY_CHARS
        finish: str | None = None
        usage: dict[str, Any] = {}
        cut = False
        try:
            async with self._client.stream("POST", f"{url}/v1/chat/completions", json=body) as resp:
                if resp.status_code != 200:
                    detail = (await resp.aread()).decode(errors="replace")[:1000]
                    if resp.status_code == 400 and "context length" in detail.lower():
                        raise _ContextTooLong(detail)
                    if "out of memory" in detail.lower():
                        raise EngineOOM(detail)
                    if resp.status_code >= 500:
                        raise EngineUnavailable(f"vLLM {resp.status_code}: {detail}")
                    raise RuntimeError(f"vLLM 拒绝请求 {resp.status_code}: {detail}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    chunk = json.loads(payload)
                    if "error" in chunk:  # 引擎异常放在 SSE 里，而不是 HTTP 状态码
                        msg = json.dumps(chunk["error"], ensure_ascii=False)[:500]
                        if "out of memory" in msg.lower():
                            raise EngineOOM(msg)
                        raise RuntimeError(f"vLLM 流内错误：{msg}")
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                    for ch in chunk.get("choices") or []:
                        delta = (ch.get("delta") or {}).get("content") or ""
                        if delta:
                            parts.append(delta)
                            n_chars += len(delta)
                        if ch.get("finish_reason"):
                            finish = ch["finish_reason"]
                    if n_chars >= next_check and finish is None:
                        next_check = n_chars + CUT_CHECK_EVERY_CHARS
                        if repetition("".join(parts)[-4000:]).detected:
                            cut = True
                            break  # 离开 async with ⇒ 关闭连接 ⇒ vLLM abort 该请求
        except httpx.TransportError as e:
            raise EngineUnavailable(f"连接 vLLM 失败（{url}）：{e}") from e
        text = "".join(parts)
        if cut:
            finish_reason = "repetition_cut"
        elif finish is None:
            raise EngineUnavailable(f"vLLM 流在没有 finish_reason 的情况下结束（{url}，已收 {n_chars} 字）")
        else:
            finish_reason = "length" if finish == "length" else "stop"
        return RawOutput(
            text.strip(),
            finish_reason,  # type: ignore[arg-type]
            usage.get("completion_tokens"),
            usage.get("prompt_tokens"),
            {"generate_s": round(time.monotonic() - t0, 3), "backend": url},
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
        if self._proc is not None and self._proc.poll() is None:
            logger.info("停止 vLLM 子进程 pid={}", self._proc.pid)
            self._proc.terminate()
            try:
                self._proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    def info(self) -> dict[str, Any]:
        return {
            "engine": self.name,
            "device": "cuda",
            "dtype": "bfloat16",
            "vllm": self._version,
            "managed": self.managed,
            "backends": [{"url": u, "inflight": self._inflight[u]} for u in self.urls],
        }


class _ContextTooLong(Exception):
    pass
