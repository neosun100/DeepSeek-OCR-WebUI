"""响应 schema（只为 Swagger 文档与合同测试）。

`extra="allow"`：pydantic 的 response_model 会静默丢掉未声明字段（aws-gpu 踩坑 #14）——
服务层多给的读数不该因为这里没写而消失；合同测试另外钉住关键字段名必须出现在 OpenAPI 里。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")


class Warning_(_Open):
    code: str = Field(description="repetition / repetition_cut / truncated / coordinate_loop / bbox_invalid / "
                      "empty_output / near_empty")  # fmt: skip
    message: str


class Box(_Open):
    label: str = Field(description="版面类型（document 模式）或识别出的文字 / 关键词（ocr / find 模式）")
    box: list[int] = Field(description="[x1, y1, x2, y2] 原图像素坐标")


class OCRResponse(_Open):
    success: bool
    ok: bool = Field(description="产物判据是否全部通过（有失败型 warning 时为 false，结果仍然返回）")
    text: str = Field(description="去掉 grounding 标记后的可读文本")
    raw_text: str = Field(description="模型原始输出（含 <|ref|>/<|det|> 标记；检出复读时已截掉复读区）")
    boxes: list[Box]
    image_dims: dict[str, int]
    prompt_type: str
    finish_reason: str = Field(description="stop / length / repetition_cut")
    warnings: list[Warning_]
    content_chars: int = Field(description="有效字母数字个数（中文按字）")
    metadata: dict[str, Any]
    request_id: str | None = None


class HealthResponse(_Open):
    status: str = Field(description="starting / error / healthy / busy / full")
    ready: bool
    version: str
    model_version: str
    model_id: str
    model_revision: str | None
    backend: str | None = Field(description="设备：cuda / mps / cpu（v4 兼容字段）")
    engine: dict[str, Any]
    model_loaded: bool
    load_error: str | None
    warmup: dict[str, Any]
    ocr_queue: dict[str, Any]
    rate_limits: dict[str, Any]


class CapabilitiesResponse(_Open):
    version: str
    model: dict[str, Any]
    engine: dict[str, Any]
    modes: dict[str, Any]
    limits: dict[str, Any]
    known_weak: list[dict[str, str]]
    inputs: dict[str, list[str]]
