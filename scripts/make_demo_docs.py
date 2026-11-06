"""生成 README 截图用的演示文档（确定性、无隐私、无版权）。

仓库 frontend/tests/e2e/samples 里的样本是体检报告 / 私人笔记 / 出版社教材扫描件 ——
可以当测试输入，但**不能**出现在对外截图里（隐私 + 版权）。截图一律用这里生成的文档。

    uv run python scripts/make_demo_docs.py   # → assets/demo/demo-report.pdf
"""

from __future__ import annotations

from pathlib import Path

import pymupdf

OUT = Path(__file__).resolve().parents[1] / "assets" / "demo"

PAGE1 = [
    ("title", "Quarterly Operations Report · 季度运营报告"),
    ("h2", "1. Summary 概要"),
    (
        "p",
        "Revenue grew 12.4% year over year to 48.6 million, while operating margin reached 31.7%. "
        "Customer satisfaction improved for the third consecutive quarter.",
    ),
    ("p", "本季度营收同比增长 12.4%，达到 4860 万元；营业利润率 31.7%。客户满意度连续第三个季度提升。"),
    ("h2", "2. Key Metrics 关键指标"),
]
TABLE = [
    ["Metric 指标", "Q1", "Q2", "Q3", "Δ YoY"],
    ["Revenue 营收 (M)", "41.2", "44.9", "48.6", "+12.4%"],
    ["Gross margin 毛利率", "58.1%", "59.0%", "60.3%", "+2.2pt"],
    ["Active users 活跃用户 (K)", "312", "347", "389", "+24.7%"],
    ["NPS 净推荐值", "41", "44", "47", "+6"],
]
PAGE2 = [
    ("h2", "3. Outlook 展望"),
    (
        "p",
        "We expect continued growth driven by the new document-automation product line. "
        "Capacity planning for Q4 assumes a 15% increase in processing volume.",
    ),
    ("p", "预计新的文档自动化产品线将持续带动增长。第四季度的容量规划按处理量增长 15% 测算。"),
    ("h2", "4. Risks 风险"),
    ("li", "• Supply constraints on GPU capacity in peak months 旺季 GPU 容量紧张"),
    ("li", "• Currency fluctuation in overseas markets 海外市场汇率波动"),
    ("li", "• Longer enterprise sales cycles 企业客户销售周期拉长"),
]

STYLE = {"title": 20, "h2": 14, "p": 10.5, "li": 10.5}


_CJK = pymupdf.Font("cjk")  # PyMuPDF 自带 Droid Sans Fallback：拉丁字母是比例宽度（china-s 是全角，英文排不开）


def _register(page: pymupdf.Page) -> None:
    page.insert_font(fontname="cjk", fontbuffer=_CJK.buffer)


def _flow(page: pymupdf.Page, blocks: list[tuple[str, str]], y: float) -> float:
    for kind, text in blocks:
        size = STYLE[kind]
        h = 22 if kind == "title" else (20 if kind == "h2" else 46 if kind == "p" else 16)
        rect = pymupdf.Rect(56, y, 539, y + h + 30)
        rc = page.insert_textbox(rect, text, fontname="cjk", fontsize=size)
        if rc < 0:
            raise ValueError(f"演示文档排版溢出：{text[:30]}")
        y += h + (12 if kind in ("title", "h2") else 8)
    return y


def _table(page: pymupdf.Page, y: float) -> float:
    widths = [190, 66, 66, 66, 95]
    row_h = 24
    for r, row in enumerate(TABLE):
        x = 56
        for c, cell in enumerate(row):
            rect = pymupdf.Rect(x, y, x + widths[c], y + row_h)
            if r == 0:
                page.draw_rect(rect, color=(0.2, 0.3, 0.5), fill=(0.88, 0.91, 0.96), width=0.6)
            else:
                page.draw_rect(rect, color=(0.6, 0.6, 0.6), width=0.5)
            page.insert_textbox(rect + (5, 6, -4, 0), cell, fontname="cjk", fontsize=9.5)
            x += widths[c]
        y += row_h
    return y + 16


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    p1 = doc.new_page(width=595, height=842)
    _register(p1)
    y = _flow(p1, PAGE1, 60)
    _table(p1, y)
    p2 = doc.new_page(width=595, height=842)
    _register(p2)
    _flow(p2, PAGE2, 60)
    doc.set_metadata({"title": "DeepSeek-OCR-WebUI demo report", "author": "DeepSeek-OCR-WebUI"})
    path = OUT / "demo-report.pdf"
    doc.subset_fonts()  # 只嵌入用到的字形：1.7 MB → 几十 KB
    doc.save(path, garbage=4, deflate=True)
    doc.close()
    print(path)


if __name__ == "__main__":
    main()
