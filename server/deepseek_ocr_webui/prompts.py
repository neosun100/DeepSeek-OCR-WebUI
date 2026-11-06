"""识别模式 → 提示词。模式名与 v4 前端 / API 完全一致（document / ocr / free / figure / describe / find / freeform）。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Mode = Literal["document", "ocr", "free", "figure", "describe", "find", "freeform"]

MAX_FIND_TERM_CHARS = 200
MAX_CUSTOM_PROMPT_CHARS = 2000


@dataclass(frozen=True)
class ModeSpec:
    body: str  # 不含 <image>\n 前缀
    grounding_default: bool  # 默认是否带 <|grounding|>（输出坐标框）
    grounding_allowed: bool  # 是否允许切换
    summary: str


MODES: dict[str, ModeSpec] = {
    # 上游官方主提示词（HF model card "Main Prompts"）：document 与 free
    "document": ModeSpec("Convert the document to markdown.", True, True, "文档 → Markdown（含版面框）"),
    "ocr": ModeSpec("OCR this image.", True, True, "通用 OCR（含文字框）"),
    "free": ModeSpec("Free OCR.", False, False, "纯文本，不保留版面"),
    "figure": ModeSpec("Parse the figure.", False, False, "图表 / 图形解析"),
    "describe": ModeSpec("Describe this image in detail.", False, False, "图像描述"),
    "find": ModeSpec("Locate <|ref|>{term}<|/ref|> in the image.", True, False, "查找并定位关键词"),
    "freeform": ModeSpec("{prompt}", False, True, "自定义提示词"),
}


def build_prompt(
    mode: str, *, find_term: str = "", custom_prompt: str = "", grounding: bool | None = None
) -> str:
    """返回完整提示词（含 `<image>\\n` 前缀）。调用方需先保证 mode 合法、参数长度在上限内。"""
    spec = MODES[mode]
    if mode == "find":
        # find 模式下关键词是 <|ref|> 的内容；去掉可能伪造的特殊标记，避免把提示词结构注入进去
        term = _strip_special(find_term).strip() or "Total"
        body = spec.body.replace("{term}", term)
    elif mode == "freeform":
        body = _strip_special(custom_prompt).strip() or "OCR this image."
    else:
        body = spec.body
    use_grounding = spec.grounding_default if (grounding is None or not spec.grounding_allowed) else grounding
    prefix = "<|grounding|>" if use_grounding else ""
    return f"<image>\n{prefix}{body}"


def _strip_special(text: str) -> str:
    for tok in ("<image>", "<|grounding|>", "<|ref|>", "<|/ref|>", "<|det|>", "<|/det|>"):
        text = text.replace(tok, "")
    return text
