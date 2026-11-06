"""transformers 推理引擎：CUDA / Apple Silicon MPS / CPU 通用。

为什么不直接调上游 `model.infer()`：上游 OCR-2 的 `infer()` 写死了 `.cuda()`、`autocast("cuda")`
和 bf16 输入（modeling_deepseekocr2.py L792-963，两份独立来源核对过）⇒ v4 的 MPS / CPU 后端「能加载、一推理必挂」
（#30 #39 #40 #45 #36）。这里按上游逻辑**逐行对齐**地重做预处理，张量按模型实际的 device / dtype 搬运，
再自己调 `generate()`；预处理用的辅助函数（dynamic_preprocess 等）直接从已加载的远程模块取，不复制它们的代码。

上游模型 forward 里还剩一处 `.cuda()`（L495 `images_seq_mask[idx].unsqueeze(-1).cuda()`）——
非 CUDA 设备上只在 generate 期间、推理锁之内把 `Tensor.cuda` 重定向到本设备，finally 还原（见 `_cuda_redirect`）。
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import math
import platform
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from loguru import logger
from PIL import Image, ImageOps

from ..judges import repetition
from .base import Engine, EngineOOM, EngineUnavailable, RawOutput

# 上游常量（modeling_deepseekocr2.py infer()）：base_size=1024 · image_size=768 · crop_mode=True
BASE_SIZE = 1024
IMAGE_SIZE = 768
PATCH_SIZE = 16
DOWNSAMPLE_RATIO = 4
IMAGE_TOKEN_ID = 128815
BOS_ID = 0
STOP_STR = "<｜end▁of▁sentence｜>"
# 上游 eval_mode 分支的 no_repeat_ngram_size（HF 内置 processor）；复读截断是在它之外的第二道防线
NO_REPEAT_NGRAM = 35
# 复读检测只看解码后的尾部这么多 token（判据本身只看尾部 3000 字符）
_TAIL_TOKENS = 1500


class HFEngine(Engine):
    name = "hf"
    max_concurrency = 1  # HF generate 不做批处理；一次一张

    def __init__(
        self,
        *,
        model_id: str,
        revision: str | None,
        model_path: str | None,
        device: str,
        attn_implementation: str | None = None,
        repetition_check_every: int = 256,
    ) -> None:
        self.model_id = model_id
        self.revision = revision
        self.model_path = model_path
        self.device = device
        self.attn_request = attn_implementation
        self.repetition_check_every = repetition_check_every
        self.model: Any = None
        self.tokenizer: Any = None
        self.dtype: Any = None
        self.attn_implementation: str | None = None
        self._mod: Any = None  # 远程代码模块（取预处理辅助函数）
        self._lock = threading.Lock()
        # 单线程执行器：所有 torch 调用都在同一个线程上，MPS / CUDA 上下文不跨线程
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hf-infer")
        self._load_notes: list[str] = []

    # ------------------------------------------------------------------ load
    async def load(self) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(self._executor, self._load)

    def _pick_dtype(self) -> Any:
        import torch

        if self.device == "cuda":
            major, minor = torch.cuda.get_device_capability()
            if major >= 8:
                return torch.bfloat16
            # sm < 80（T4 / V100 / 20 系）没有原生 bf16：用 fp16。上游输入写死 bf16，这里预处理按模型 dtype 转，不会再错配
            self._load_notes.append(f"GPU 计算能力 {major}.{minor} < 8.0，使用 float16")
            return torch.float16
        if self.device == "mps":
            # M5 Max 实测 bf16 可用（2026-11-07 探针）；更老的芯片 / 系统不支持时降 fp16，并留痕
            try:
                (torch.ones(2, device="mps", dtype=torch.bfloat16) * 2).sum().item()
                return torch.bfloat16
            except Exception as e:  # noqa: BLE001 —— 探测失败形态因 torch 版本而异；降级 fp16 并留痕
                self._load_notes.append(f"MPS 不支持 bfloat16（{type(e).__name__}），降级 float16")
                return torch.float16
        # CPU：bf16 matmul 在没有 AVX512-BF16 / AMX 的 CPU 上比 fp32 还慢，且 conv 有精度坑 ⇒ fp32
        return torch.float32

    def _pick_attn(self) -> str:
        if self.attn_request:
            return self.attn_request
        if self.device == "cuda":
            try:
                import flash_attn  # noqa: F401

                return "flash_attention_2"
            except ImportError:
                self._load_notes.append("未安装 flash-attn，CUDA 上使用 eager attention（更慢、更占显存）")
        return "eager"

    def _load(self) -> None:
        import torch
        from transformers import AutoModel, AutoTokenizer

        src = self.model_path or self.model_id
        rev = None if self.model_path else self.revision
        self.dtype = self._pick_dtype()
        self.attn_implementation = self._pick_attn()
        t0 = time.monotonic()
        logger.info(
            "加载模型 {} (revision={}) device={} dtype={} attn={}",
            src, rev, self.device, self.dtype, self.attn_implementation,
        )  # fmt: skip
        self.tokenizer = AutoTokenizer.from_pretrained(src, trust_remote_code=True, revision=rev)
        kwargs: dict[str, Any] = dict(
            trust_remote_code=True,
            use_safetensors=True,
            torch_dtype=self.dtype,
            revision=rev,
            attn_implementation=self.attn_implementation,
        )
        if self.device == "cuda":
            kwargs["low_cpu_mem_usage"] = True
        try:
            model = AutoModel.from_pretrained(src, **kwargs)
        except (ImportError, ValueError) as e:
            if self.attn_implementation == "eager":
                raise
            # flash-attn 装了但与 GPU / torch 不兼容（如 sm<80）：降 eager 并留痕，而不是像 v4 那样吞掉真实错误
            self._load_notes.append(f"{self.attn_implementation} 不可用（{e}），降级 eager")
            logger.warning("attention 降级 eager：{}", e)
            self.attn_implementation = "eager"
            kwargs["attn_implementation"] = "eager"
            model = AutoModel.from_pretrained(src, **kwargs)
        self.model = model.eval().to(self.device)
        self._mod = sys.modules[type(self.model).__module__]
        for fn in ("dynamic_preprocess", "BasicImageTransform", "text_encode", "format_messages"):
            if not hasattr(self._mod, fn):
                raise EngineUnavailable(
                    f"上游远程代码缺少 {fn}：revision 与本引擎不匹配（期望 {self.revision}）"
                )
        if self.device == "cuda":
            torch.cuda.synchronize()
        logger.info("模型加载完成，用时 {:.1f}s", time.monotonic() - t0)

    # ----------------------------------------------------------- preprocess
    def _prepare(self, image: Image.Image, prompt: str) -> dict[str, Any]:
        """逐行对齐上游 infer()（crop_mode=True 分支）。返回 generate 所需的 CPU 张量。"""
        import torch

        m = self._mod
        transform = m.BasicImageTransform(mean=(0.5, 0.5, 0.5), std=(0.5, 0.5, 0.5), normalize=True)
        conversation = [
            {"role": "<|User|>", "content": prompt, "images": []},
            {"role": "<|Assistant|>", "content": ""},
        ]
        formatted = m.format_messages(conversations=conversation, sft_format="plain", system_prompt="")
        text_splits = formatted.split("<image>")
        if len(text_splits) != 2:
            raise ValueError("提示词必须恰好包含一个 <image>")

        tokens: list[int] = []
        seq_mask: list[bool] = []
        sep = m.text_encode(self.tokenizer, text_splits[0], bos=False, eos=False)
        tokens += sep
        seq_mask += [False] * len(sep)

        if image.size[0] <= IMAGE_SIZE and image.size[1] <= IMAGE_SIZE:
            crop_ratio = [1, 1]
            crops_raw: list[Image.Image] = []
        else:
            crops_raw, crop_ratio = m.dynamic_preprocess(image)
        pad_color = tuple(int(x * 255) for x in transform.mean)
        global_view = ImageOps.pad(image, (BASE_SIZE, BASE_SIZE), color=pad_color)
        images_ori = transform(global_view).unsqueeze(0)
        w_crop, h_crop = crop_ratio
        if w_crop > 1 or h_crop > 1:
            images_crop = torch.stack([transform(c) for c in crops_raw], dim=0)
        else:
            images_crop = torch.zeros((1, 3, BASE_SIZE, BASE_SIZE))

        nq = math.ceil((IMAGE_SIZE // PATCH_SIZE) / DOWNSAMPLE_RATIO)
        nq_base = math.ceil((BASE_SIZE // PATCH_SIZE) / DOWNSAMPLE_RATIO)
        img_tokens = [IMAGE_TOKEN_ID] * (nq_base * nq_base) + [IMAGE_TOKEN_ID]
        if w_crop > 1 or h_crop > 1:
            img_tokens += [IMAGE_TOKEN_ID] * ((nq * w_crop) * (nq * h_crop))
        tokens += img_tokens
        seq_mask += [True] * len(img_tokens)

        sep = m.text_encode(self.tokenizer, text_splits[1], bos=False, eos=False)
        tokens += sep
        seq_mask += [False] * len(sep)
        tokens = [BOS_ID, *tokens]
        seq_mask = [False, *seq_mask]
        return {
            "input_ids": torch.LongTensor(tokens),
            "images_seq_mask": torch.tensor(seq_mask, dtype=torch.bool),
            "images_crop": images_crop,
            "images_ori": images_ori,
            "images_spatial_crop": torch.tensor([crop_ratio], dtype=torch.long),
        }

    # -------------------------------------------------------------- generate
    @contextlib.contextmanager
    def _cuda_redirect(self):  # type: ignore[no-untyped-def]
        """非 CUDA 设备：generate 期间把 Tensor.cuda 指向本设备（上游 forward L495 写死 .cuda()）。
        只在 self._lock 之内调用；同进程没有别的线程会在非 CUDA 机器上调 .cuda()（调了本来也会失败）。"""
        import torch

        if self.device == "cuda":
            yield
            return
        orig = torch.Tensor.cuda
        dev = self.device
        torch.Tensor.cuda = lambda t, *a, **k: t.to(dev)  # type: ignore[method-assign,assignment]
        try:
            yield
        finally:
            torch.Tensor.cuda = orig  # type: ignore[method-assign]

    def _infer_sync(self, image: Image.Image, prompt: str, max_tokens: int) -> RawOutput:
        import torch
        from transformers import StoppingCriteria, StoppingCriteriaList

        if self.model is None:
            raise EngineUnavailable("模型尚未加载")
        t0 = time.monotonic()
        inp = self._prepare(image, prompt)
        t_pre = time.monotonic() - t0
        dev, dtype = self.device, self.dtype
        input_ids = inp["input_ids"].unsqueeze(0).to(dev)
        prompt_len = input_ids.shape[1]
        tokenizer = self.tokenizer
        every = max(16, self.repetition_check_every)
        state = {"cut": False}

        class _RepetitionStop(StoppingCriteria):
            def __call__(self, ids: Any, scores: Any, **kw: Any) -> Any:
                n_new = ids.shape[1] - prompt_len
                if n_new > 0 and n_new % every == 0:
                    tail = tokenizer.decode(ids[0, max(prompt_len, ids.shape[1] - _TAIL_TOKENS) :])
                    if repetition(tail).detected:
                        state["cut"] = True
                return torch.full((ids.shape[0],), state["cut"], dtype=torch.bool, device=ids.device)

        autocast = torch.autocast("cuda", dtype=dtype) if dev == "cuda" else contextlib.nullcontext()
        if dev == "cuda":
            torch.cuda.reset_peak_memory_stats()
        try:
            # 上游 forward 每次推理都往 stdout print 张量形状（"BASE: torch.Size…"）⇒ 静音，日志只走 loguru
            with (
                self._lock,
                self._cuda_redirect(),
                autocast,
                torch.no_grad(),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                out_ids = self.model.generate(
                    input_ids,
                    attention_mask=torch.ones_like(input_ids),  # #27：显式给 mask，消除 pad==eos 歧义告警
                    images=[(inp["images_crop"].to(dev, dtype), inp["images_ori"].to(dev, dtype))],
                    images_seq_mask=inp["images_seq_mask"].unsqueeze(0).to(dev),
                    images_spatial_crop=inp["images_spatial_crop"],
                    do_sample=False,
                    eos_token_id=tokenizer.eos_token_id,
                    pad_token_id=tokenizer.eos_token_id,
                    max_new_tokens=max_tokens,
                    no_repeat_ngram_size=NO_REPEAT_NGRAM,
                    use_cache=True,
                    stopping_criteria=StoppingCriteriaList([_RepetitionStop()]),
                )
        except torch.OutOfMemoryError as e:
            if dev == "cuda":
                torch.cuda.empty_cache()
            raise EngineOOM(str(e)) from e
        except RuntimeError as e:
            if "out of memory" in str(e).lower():  # MPS 的 OOM 是 RuntimeError
                raise EngineOOM(str(e)) from e
            raise
        gen = out_ids[0, prompt_len:]
        n_gen = int(gen.shape[0])
        text = tokenizer.decode(gen)
        hit_eos = n_gen > 0 and int(gen[-1]) == tokenizer.eos_token_id
        if text.endswith(STOP_STR):
            text = text[: -len(STOP_STR)]
        if state["cut"]:
            finish = "repetition_cut"
        elif n_gen >= max_tokens and not hit_eos:
            finish = "length"
        else:
            finish = "stop"
        extra: dict[str, Any] = {
            "preprocess_s": round(t_pre, 3),
            "generate_s": round(time.monotonic() - t0 - t_pre, 3),
        }
        if dev == "cuda":
            extra["vram_peak_mib"] = round(torch.cuda.max_memory_allocated() / 2**20)
        return RawOutput(text.strip(), finish, n_gen, prompt_len, extra)  # type: ignore[arg-type]

    async def infer(self, image: Image.Image, prompt: str, *, max_tokens: int) -> RawOutput:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._infer_sync, image, prompt, max_tokens)

    async def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def info(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "engine": self.name,
            "device": self.device,
            "dtype": str(self.dtype).replace("torch.", "") if self.dtype is not None else None,
            "attn_implementation": self.attn_implementation,
            "notes": list(self._load_notes),
        }
        try:
            import torch
            import transformers

            info["torch"] = torch.__version__
            info["transformers"] = transformers.__version__
            if self.device == "cuda" and torch.cuda.is_available():
                info["gpu"] = torch.cuda.get_device_name(0)
                info["cuda"] = torch.version.cuda
            if self.device == "mps":
                info["chip"] = platform.processor() or platform.machine()
        except ImportError:
            pass
        return info
