"""推理引擎协议。服务层只依赖这里，不依赖 torch / vllm（测试与无 GPU 环境可以只装核心依赖）。"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any, Literal

from PIL import Image

FinishReason = Literal["stop", "length", "repetition_cut"]


@dataclass
class RawOutput:
    text: str
    finish_reason: FinishReason
    completion_tokens: int | None = None
    prompt_tokens: int | None = None
    # 引擎侧的额外读数（耗时分段、显存峰值等），原样进响应的 metadata.engine
    extra: dict[str, Any] = field(default_factory=dict)


class EngineUnavailable(RuntimeError):
    """引擎当前不能服务（未加载 / 加载失败 / 后端失联）。服务层映射成 503。"""


class EngineOOM(RuntimeError):
    """显存不足。服务层映射成 503 backend_oom（可重试），而不是笼统的 500。"""


class Engine(abc.ABC):
    name: str = "base"
    #: 同时可以送进引擎的请求数（HF = 1；vLLM = 连续批处理的在途上限）
    max_concurrency: int = 1

    @abc.abstractmethod
    async def load(self) -> None:
        """加载模型（可能很久）；失败抛异常，由服务层记录到 health。"""

    @abc.abstractmethod
    async def infer(self, image: Image.Image, prompt: str, *, max_tokens: int) -> RawOutput:
        """单图推理。prompt 含 `<image>\\n` 前缀。"""

    async def close(self) -> None:  # noqa: B027 —— 默认无事可做，子类按需覆盖
        """释放资源（子进程、显存）。"""

    def info(self) -> dict[str, Any]:
        """进 /health 的静态信息：设备、dtype、版本、revision。"""
        return {"engine": self.name}
