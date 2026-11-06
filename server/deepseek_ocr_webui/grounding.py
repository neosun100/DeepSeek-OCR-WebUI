"""DeepSeek-OCR grounding 输出解析：`<|ref|>label<|/ref|><|det|>[[x1,y1,x2,y2], ...]<|/det|>`。

- 坐标是 0–999 归一值（上游脚本按 /999 还原像素）。
- label 有两种语义：document 模式下是**版面类型**（text / table / title…），ocr / find 模式下是**文字本身**。
  v4 把整块替换成 label ⇒ document 模式的显示文本里混进了 "table" "sub_title" 这类词（仓库样本可见）。
- 坐标只用正则提数，绝不 eval —— 上游脚本对模型生成的坐标串做 `eval`（Unlimited-OCR #115 同源问题）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_BLOCK = re.compile(r"<\|ref\|>(?P<label>.*?)<\|/ref\|>\s*<\|det\|>(?P<coords>.*?)<\|/det\|>", re.DOTALL)
_BOX = re.compile(
    r"\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]"
)
_ORPHAN_TAGS = re.compile(r"<\|/?(?:ref|det|grounding)\|>")

# DeepSeek-OCR / OCR-2 文档模式出现过的版面类型（上游 eval 脚本 + 实际输出）
LAYOUT_LABELS = frozenset(
    {
        "title", "sub_title", "text", "table", "table_caption", "table_footnote", "image", "image_caption",
        "figure", "figure_caption", "formula", "equation", "header", "footer", "page_header", "page_footer",
        "page_number", "list", "list_item", "code", "caption", "footnote", "reference", "abstract", "author",
        "algorithm", "chart", "seal", "aside_text",
    }
)  # fmt: skip

COORD_SCALE = 999


@dataclass(frozen=True)
class Box:
    label: str
    box: tuple[int, int, int, int]  # 像素坐标（原图尺寸）

    def as_dict(self) -> dict:
        return {"label": self.label, "box": list(self.box)}


def is_layout_label(label: str) -> bool:
    return label.strip().lower() in LAYOUT_LABELS


def parse_boxes(raw: str, width: int, height: int) -> tuple[list[Box], int]:
    """返回 (合法框, 不合法框个数)。不合法 = 越界 / x1>x2 / y1>y2；不合法的框丢掉，但不影响文字。"""
    boxes: list[Box] = []
    invalid = 0
    for m in _BLOCK.finditer(raw or ""):
        label = m.group("label").strip()
        for g in _BOX.finditer(m.group("coords")):
            x1, y1, x2, y2 = (float(v) for v in g.groups())
            if not (0 <= x1 <= x2 <= COORD_SCALE + 1 and 0 <= y1 <= y2 <= COORD_SCALE + 1):
                invalid += 1
                continue
            boxes.append(
                Box(
                    label,
                    (
                        round(x1 / COORD_SCALE * width),
                        round(y1 / COORD_SCALE * height),
                        round(x2 / COORD_SCALE * width),
                        round(y2 / COORD_SCALE * height),
                    ),
                )
            )
    return boxes, invalid


def clean_text(raw: str) -> str:
    """去掉 grounding 标记得到可读文本：版面类型块整块删除，文字型 label 保留为文字。"""

    def _sub(m: re.Match[str]) -> str:
        label = m.group("label").strip()
        return "" if is_layout_label(label) else label

    text = _BLOCK.sub(_sub, raw or "")
    text = _ORPHAN_TAGS.sub("", text)
    # 删块后留下的「块头换行」：每个块原本是 `<ref..det>\n内容`，删掉块头后行首多一个换行
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
