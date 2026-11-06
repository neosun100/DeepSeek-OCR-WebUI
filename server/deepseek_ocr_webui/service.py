"""服务层：准入（排队 / 限流）· 引擎生命周期（后台加载 + 预热）· 单页推理 + 判据。

HTTP 层（app.py）只做参数解析与响应编排；这里不 import FastAPI 之外的 Web 细节，便于单测。
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import time
import uuid
from collections import OrderedDict
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from loguru import logger
from PIL import Image

from . import __version__
from .config import Limits, Settings
from .engines import Engine, EngineOOM, EngineUnavailable
from .errors import EngineError, InputError
from .grounding import clean_text, parse_boxes
from .judges import JudgeLimits, content_chars, judge_page, repetition, strip_layout
from .prompts import build_prompt

# X-Client-ID 只接受这个形状；否则当没给（防止把任意长串塞进内存字典 / 日志）
_CLIENT_ID = re.compile(r"[A-Za-z0-9_\-]{1,64}")

# 预热页的已知文字：中英数字都有，召回不够说明模型 / 预处理坏了（产物判据，而不是「没报错」）
WARMUP_TEXT = "DeepSeek OCR warmup 2026 识别测试 12345"
WARMUP_RECALL_MIN = 0.85


def valid_client_id(raw: str | None) -> str | None:
    if raw and _CLIENT_ID.fullmatch(raw):  # fullmatch：re.match + $ 会放过结尾换行
        return raw
    return None


@dataclass
class Ticket:
    request_id: str
    client_id: str | None
    ip: str
    created: float = field(default_factory=time.monotonic)


class Admission:
    """准入控制：全局排队上限 + 每客户端 / 每 IP 在途上限。语义与 v4 一致（前端依赖 429 的三种原因）。"""

    def __init__(self, max_queue: int, max_per_client: int, max_per_ip: int) -> None:
        self.max_queue = max_queue
        self.max_per_client = max_per_client
        self.max_per_ip = max_per_ip
        self._queue: OrderedDict[str, Ticket] = OrderedDict()
        self._clients: dict[str, int] = {}
        self._ips: dict[str, int] = {}

    @property
    def depth(self) -> int:
        return len(self._queue)

    def acquire(self, client_id: str | None, ip: str, request_id: str) -> Ticket:
        # 单线程事件循环里调用，无需锁（v4 用 threading.Lock 是因为它在线程池里改计数）
        if self.depth >= self.max_queue:
            raise InputError(
                429, "queue_full", "OCR queue full, please retry later（服务排队已满）",
                actual=self.depth, limit=self.max_queue, headers={"Retry-After": "5"},
            )  # fmt: skip
        if client_id and self._clients.get(client_id, 0) >= self.max_per_client:
            raise InputError(
                429, "client_limit", f"Client at max concurrency ({self.max_per_client})（该客户端已有任务在处理）",
                actual=self._clients[client_id], limit=self.max_per_client, headers={"Retry-After": "2"},
            )  # fmt: skip
        if self._ips.get(ip, 0) >= self.max_per_ip:
            raise InputError(
                429, "ip_limit", f"IP at max concurrency ({self.max_per_ip})（该网络的并发请求过多）",
                actual=self._ips[ip], limit=self.max_per_ip, headers={"Retry-After": "2"},
            )  # fmt: skip
        t = Ticket(request_id, client_id, ip)
        self._queue[request_id] = t
        if client_id:
            self._clients[client_id] = self._clients.get(client_id, 0) + 1
        self._ips[ip] = self._ips.get(ip, 0) + 1
        return t

    def release(self, t: Ticket) -> None:
        if self._queue.pop(t.request_id, None) is None:
            return  # 幂等：重复释放不把计数减成负数
        if t.client_id:
            self._clients[t.client_id] -= 1
            if self._clients[t.client_id] <= 0:
                del self._clients[t.client_id]
        self._ips[t.ip] -= 1
        if self._ips[t.ip] <= 0:
            del self._ips[t.ip]

    def position(self, client_id: str) -> int | None:
        for i, t in enumerate(self._queue.values()):
            if t.client_id == client_id:
                return i + 1
        return None

    def snapshot(self) -> dict[str, int]:
        return {"depth": self.depth, "active_clients": len(self._clients), "active_ips": len(self._ips)}


@dataclass
class PageRequest:
    mode: str
    find_term: str = ""
    custom_prompt: str = ""
    grounding: bool | None = None


class OCRService:
    def __init__(self, settings: Settings, engine: Engine) -> None:
        self.settings = settings
        self.engine = engine
        self.admission = Admission(settings.max_queue, settings.max_per_client, settings.max_per_ip)
        self._slots = asyncio.Semaphore(max(1, engine.max_concurrency))
        self.state = "starting"  # starting → ready | error
        self.load_error: str | None = None
        self.warmup: dict[str, Any] = {"ok": None, "reason": "未执行"}
        self.started_at = time.time()
        self._load_task: asyncio.Task[None] | None = None
        self.inflight = 0
        self.served = 0

    # ---------------------------------------------------------- lifecycle
    def start_background(self) -> None:
        self._load_task = asyncio.create_task(self._load(), name="engine-load")

    async def _load(self) -> None:
        t0 = time.monotonic()
        try:
            await self.engine.load()
            logger.info("引擎 {} 加载完成（{:.1f}s）", self.engine.name, time.monotonic() - t0)
            if self.settings.warmup:
                await self._warm()
                if self.warmup["ok"] is False:
                    self.state = "error"
                    self.load_error = f"预热产物不合格：{self.warmup.get('reason')}"
                    logger.error(self.load_error)
                    return
            self.state = "ready"
        except Exception as e:  # noqa: BLE001 —— 加载失败不能让进程崩：health 必须能把原因报出来
            self.state = "error"
            self.load_error = f"{type(e).__name__}: {e}"
            logger.opt(exception=e).error("引擎加载失败")

    async def _warm(self) -> None:
        """合成一页已知文字走完整链路；召回 ≥ 0.85 才算 ready（HTTP 200 ≠ 能出正确结果）。"""
        img = render_text_image(WARMUP_TEXT)
        t0 = time.monotonic()
        try:
            out = await self.engine.infer(img, build_prompt("free"), max_tokens=256)
        except Exception as e:  # noqa: BLE001 —— 预热失败如实记进 health（state=error），不抛
            self.warmup = {"ok": False, "reason": f"预热推理异常 {type(e).__name__}: {e}"}
            return
        recall = char_recall(WARMUP_TEXT, out.text)
        ok = recall >= WARMUP_RECALL_MIN
        self.warmup = {
            "ok": ok,
            "recall": round(recall, 3),
            "recall_min": WARMUP_RECALL_MIN,
            "seconds": round(time.monotonic() - t0, 2),
            "output": out.text[:200],
            "reason": None if ok else f"预热页字符召回 {recall:.2f} < {WARMUP_RECALL_MIN}",
        }
        logger.info("预热完成 recall={:.3f} 用时 {:.1f}s", recall, self.warmup["seconds"])

    async def close(self) -> None:
        if self._load_task and not self._load_task.done():
            self._load_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._load_task
        await self.engine.close()

    # ------------------------------------------------------------ requests
    def require_ready(self) -> None:
        if self.state == "ready":
            return
        if self.state == "starting":
            raise EngineError(
                503, "model_loading", "模型仍在加载 / 预热中，请稍后重试",
                actual=self.state, headers={"Retry-After": "10"},
            )  # fmt: skip
        raise EngineError(503, "model_unavailable", f"模型不可用：{self.load_error}", actual=self.state)

    @contextlib.asynccontextmanager
    async def admitted(self, client_id: str | None, ip: str, request_id: str) -> AsyncIterator[Ticket]:
        self.require_ready()
        ticket = self.admission.acquire(client_id, ip, request_id)
        try:
            yield ticket
        finally:
            self.admission.release(ticket)

    async def ocr_image(
        self, image: Image.Image, req: PageRequest, *, is_disconnected: Any = None
    ) -> dict[str, Any]:
        prompt = build_prompt(
            req.mode, find_term=req.find_term, custom_prompt=req.custom_prompt, grounding=req.grounding
        )
        t_queue = time.monotonic()
        async with self._slots:
            queue_s = time.monotonic() - t_queue
            # 排队期间客户端已断开（关标签页 / 刷新，#47）：不再占 GPU 推理
            if is_disconnected is not None and await is_disconnected():
                raise InputError(499, "client_disconnected", "客户端已断开，跳过推理")
            self.inflight += 1
            t0 = time.monotonic()
            try:
                raw = await asyncio.wait_for(
                    self.engine.infer(image, prompt, max_tokens=self.settings.max_new_tokens),
                    timeout=self.settings.request_timeout_s,
                )
            except asyncio.TimeoutError as e:
                raise EngineError(
                    504, "inference_timeout", "推理超时",
                    actual=f"{time.monotonic() - t0:.0f}s", limit=f"{self.settings.request_timeout_s:.0f}s",
                ) from e  # fmt: skip
            except EngineOOM as e:
                raise EngineError(
                    503, "backend_oom", f"显存不足，请减小图片尺寸或稍后重试：{str(e)[:200]}",
                    headers={"Retry-After": "10"},
                ) from e  # fmt: skip
            except EngineUnavailable as e:
                raise EngineError(503, "backend_unavailable", str(e)[:500]) from e
            finally:
                self.inflight -= 1
            infer_s = time.monotonic() - t0
        self.served += 1
        return self._postprocess(raw, image, req, prompt, queue_s, infer_s)

    def _postprocess(
        self, raw: Any, image: Image.Image, req: PageRequest, prompt: str, queue_s: float, infer_s: float
    ) -> dict[str, Any]:
        w, h = image.size
        text_raw = raw.text
        trimmed = 0
        rep = repetition(text_raw)
        if rep.detected and rep.period:
            # 复读区只保留一个周期：导出（前端用 raw_text 生成 Markdown/DOCX）里不该出现上千字的重复
            keep = len(text_raw) - rep.extent_chars + rep.period
            trimmed = len(text_raw) - keep
            text_raw = text_raw[:keep]
        boxes, bbox_invalid = parse_boxes(text_raw, w, h) if "<|det|>" in text_raw else ([], 0)
        verdict = judge_page(
            raw.text, raw.finish_reason, near_empty_chars=Limits.NEAR_EMPTY_CHARS, bbox_invalid=bbox_invalid
        )
        if trimmed:
            for wobj in verdict.warnings:
                if wobj["code"] in ("repetition", "repetition_cut"):
                    wobj["trimmed_chars"] = trimmed
        display = clean_text(text_raw)
        if not display and boxes:
            display = ", ".join(b.label for b in boxes)  # find 模式：只有框没有正文
        info = self.engine.info()
        return {
            "success": True,
            "ok": verdict.ok,
            "text": display,
            "raw_text": text_raw,
            "boxes": [b.as_dict() for b in boxes],
            "image_dims": {"w": w, "h": h},
            "prompt_type": req.mode,
            "finish_reason": raw.finish_reason,
            "warnings": verdict.warnings,
            "content_chars": verdict.content_chars,
            "metadata": {
                "mode": req.mode,
                "prompt": prompt,
                "backend": info.get("device"),  # v4 字段：cuda / mps / cpu
                "engine": info.get("engine"),
                "has_boxes": bool(boxes),
                "tokens": {"prompt": raw.prompt_tokens, "completion": raw.completion_tokens},
                "timing": {"queue_s": round(queue_s, 3), "infer_s": round(infer_s, 3), **raw.extra},
            },
        }

    # ------------------------------------------------------------- health
    def health(self, client_id: str | None = None) -> dict[str, Any]:
        snap = self.admission.snapshot()
        depth = snap["depth"]
        if self.state != "ready":
            status = self.state  # starting / error
        elif depth >= self.settings.max_queue:
            status = "full"
        elif depth >= self.settings.max_queue / 2:
            status = "busy"
        else:
            status = "healthy"
        info = self.engine.info()
        body: dict[str, Any] = {
            "status": status,
            "ready": self.state == "ready",
            "version": __version__,
            "model_version": "DeepSeek-OCR-2",
            "model_id": self.settings.model_path or self.settings.model_id,
            "model_revision": None if self.settings.model_path else self.settings.model_revision,
            "backend": info.get("device"),
            "engine": info,
            "model_loaded": self.state == "ready",
            "load_error": self.load_error,
            "warmup": self.warmup,
            "uptime_s": round(time.time() - self.started_at),
            "inflight": self.inflight,
            "served": self.served,
            "ocr_queue": {"depth": depth, "max_size": self.settings.max_queue, "is_full": status == "full"},
            "rate_limits": {
                "max_per_client": self.settings.max_per_client,
                "max_per_ip": self.settings.max_per_ip,
                "active_clients": snap["active_clients"],
                "active_ips": snap["active_ips"],
            },
        }
        if client_id:
            body["your_queue_status"] = {
                "client_id": client_id,
                "position": self.admission.position(client_id),
                "total_queued": depth,
            }
        return body


def new_request_id() -> str:
    return uuid.uuid4().hex[:12]


def char_recall(truth: str, pred: str) -> float:
    """真值字母数字在输出里的多重集召回（预热判据用）。"""
    import unicodedata
    from collections import Counter

    def chars(s: str) -> Counter[str]:
        return Counter(c for c in unicodedata.normalize("NFKC", s).lower() if c.isalnum())

    t, p = chars(truth), chars(strip_layout(pred))
    return sum(min(n, p[c]) for c, n in t.items()) / max(1, sum(t.values()))


def render_text_image(text: str, width: int = 900, height: int = 160) -> Image.Image:
    """用 PyMuPDF 内置 CJK 字体（china-s）排一行字 ⇒ 不依赖系统字体，任何环境都能生成预热页。"""
    import pymupdf as fitz

    doc = fitz.open()
    page = doc.new_page(width=width / 2, height=height / 2)
    page.insert_text((14, height / 4 + 8), text, fontname="china-s", fontsize=17)
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    doc.close()
    return img


__all__ = [
    "Admission",
    "JudgeLimits",
    "OCRService",
    "PageRequest",
    "content_chars",
    "new_request_id",
    "render_text_image",
    "valid_client_id",
]
