"""测试替身：按脚本返回「各种坏产物」，让服务层的判据 / 错误映射在没有 GPU 的地方也能被测到。

脚本由 prompt / 图像尺寸决定，便于测试精确构造：
- 图宽 == 13  ⇒ 尾部逐字复读（应出 repetition warning）
- 图宽 == 17  ⇒ 坐标循环
- 图宽 == 19  ⇒ 空输出
- 图宽 == 23  ⇒ 抛 EngineOOM
- 图宽 == 29  ⇒ 抛 RuntimeError（未分类错误）
- 图宽 == 31  ⇒ finish_reason=length
- 图宽 == 37  ⇒ 慢请求（sleep 0.5 s，用于并发/限流测试）
- 其余       ⇒ 正常的 grounding 文档输出
"""

from __future__ import annotations

import asyncio
from typing import Any

from PIL import Image

from .base import Engine, EngineOOM, RawOutput

WARMUP_SIZE = (900, 160)  # = service.render_text_image 默认尺寸

NORMAL = (
    "<|ref|>title<|/ref|><|det|>[[100, 50, 900, 120]]<|/det|>\n# Fake Title\n\n"
    "<|ref|>text<|/ref|><|det|>[[100, 150, 900, 400]]<|/det|>\nHello DeepSeek OCR 你好世界 12345."
)


class FakeEngine(Engine):
    name = "fake"

    def __init__(
        self,
        max_concurrency: int = 1,
        delay_s: float = 0.0,
        *,
        warmup_text: str | None = None,
        fail_load: str | None = None,
        load_delay_s: float = 0.0,
    ) -> None:
        self.max_concurrency = max_concurrency
        self.delay_s = delay_s
        # 预热页（service.render_text_image 的固定尺寸）回这段文字；None = 回 NORMAL（预热召回会不达标）
        self.warmup_text = warmup_text
        self.fail_load = fail_load
        self.load_delay_s = load_delay_s
        self.loaded = False
        self.calls: list[dict[str, Any]] = []
        self.inflight = 0
        self.max_seen_inflight = 0

    async def load(self) -> None:
        if self.load_delay_s:
            await asyncio.sleep(self.load_delay_s)
        if self.fail_load:
            raise RuntimeError(self.fail_load)
        self.loaded = True

    async def infer(self, image: Image.Image, prompt: str, *, max_tokens: int) -> RawOutput:
        self.calls.append({"prompt": prompt, "size": image.size, "max_tokens": max_tokens})
        self.inflight += 1
        self.max_seen_inflight = max(self.max_seen_inflight, self.inflight)
        try:
            w = image.size[0]
            if self.delay_s or w == 37:
                await asyncio.sleep(self.delay_s or 0.5)
            if image.size == WARMUP_SIZE:
                return RawOutput(self.warmup_text if self.warmup_text is not None else NORMAL, "stop", 12)
            if w == 13:
                return RawOutput("开头正常。" + "重复的一句话，" * 400, "stop", 3000)
            if w == 17:
                return RawOutput(
                    "<|ref|>text<|/ref|><|det|>[[23, 268, 268, 268, 268, 268, 268, 268]]<|/det|>", "stop"
                )
            if w == 19:
                return RawOutput("", "stop", 0)
            if w == 23:
                raise EngineOOM("CUDA out of memory (fake)")
            if w == 29:
                raise RuntimeError("fake engine exploded")
            if w == 31:
                return RawOutput(NORMAL, "length", max_tokens)
            if "<|grounding|>" not in prompt:
                return RawOutput("# Fake Title\n\nHello DeepSeek OCR 你好世界 12345.", "stop", 20)
            return RawOutput(NORMAL, "stop", 42)
        finally:
            self.inflight -= 1

    def info(self) -> dict[str, Any]:
        return {"engine": self.name, "device": "none", "dtype": "none"}
