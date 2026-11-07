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
    # OCR-2 没有原生的「按关键词定位」：上游 README 只有 document / Free OCR 两个提示词；
    # 2026-11-07 实测 2 张图 × 3 个词 × 2 种 Locate 写法 = 12 次全部退回文档解析（v4.0 起 find 模式实际从未生效）。
    # ⇒ find = 带版面框的文档解析 + 服务端在版面块文字里找关键词（块级精度，见 service.py）
    "find": ModeSpec("Convert the document to markdown.", True, False, "查找关键词（版面块级定位）"),
    "freeform": ModeSpec("{prompt}", False, True, "自定义提示词"),
}


def build_prompt(
    mode: str, *, find_term: str = "", custom_prompt: str = "", grounding: bool | None = None
) -> str:
    """返回完整提示词（含 `<image>\\n` 前缀）。调用方需先保证 mode 合法、参数长度在上限内。"""
    spec = MODES[mode]
    body = (_strip_special(custom_prompt).strip() or "OCR this image.") if mode == "freeform" else spec.body
    use_grounding = spec.grounding_default if (grounding is None or not spec.grounding_allowed) else grounding
    prefix = "<|grounding|>" if use_grounding else ""
    return f"<image>\n{prefix}{body}"


def clean_find_term(text: str) -> str:
    """find 关键词：去掉特殊标记与首尾空白（它只在服务端做匹配，不进模型提示词）。"""
    return _strip_special(text).strip()


def _strip_special(text: str) -> str:
    for tok in ("<image>", "<|grounding|>", "<|ref|>", "<|/ref|>", "<|det|>", "<|/det|>"):
        text = text.replace(tok, "")
    return text
