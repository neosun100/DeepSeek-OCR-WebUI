"""打真实运行中的服务：`DSOCR_BASE=http://127.0.0.1:8001 uv run pytest tests/e2e -m e2e`。

判据是**产物**：已知真值的子串 / 字符召回 / 无复读 / 框坐标合法 —— 不是状态码。
服务不可达 ⇒ skip（不是通过）；可达但不 ready ⇒ **fail**（部署坏了不能被 skip 盖住）。
"""

from __future__ import annotations

import json
import os
import time

import httpx
import pytest

from deepseek_ocr_webui.service import char_recall, render_text_image

from ..conftest import SAMPLES, pdf_bytes

pytestmark = pytest.mark.e2e
BASE = os.environ.get("DSOCR_BASE", "").rstrip("/")


@pytest.fixture(scope="module")
def http() -> httpx.Client:
    if not BASE:
        pytest.skip("DSOCR_BASE 未设置")
    c = httpx.Client(base_url=BASE, timeout=600)
    try:
        c.get("/health/live")
    except httpx.HTTPError as e:
        pytest.skip(f"服务不可达：{e}")
    deadline = time.monotonic() + float(os.environ.get("DSOCR_READY_TIMEOUT", "900"))
    while time.monotonic() < deadline:
        h = c.get("/health").json()
        if h["status"] != "starting":
            break
        time.sleep(5)
    assert h["ready"], f"服务可达但不 ready：{h.get('status')} {h.get('load_error')}"
    return c


def ocr(http: httpx.Client, path, mode: str = "document", **data: str) -> dict:
    with open(path, "rb") as f:
        r = http.post("/api/ocr", files={"file": (path.name, f)}, data={"prompt_type": mode, **data})
    assert r.status_code == 200, r.text[:500]
    return r.json()


def test_health_reports_engine(http: httpx.Client) -> None:
    h = http.get("/health").json()
    assert h["warmup"]["ok"] is True and h["warmup"]["recall"] >= 0.85
    assert h["engine"]["engine"] in ("hf", "vllm")
    print("ENGINE", json.dumps(h["engine"], ensure_ascii=False))


def test_table_document(http: httpx.Client) -> None:
    b = ocr(http, SAMPLES / "sample.png")
    assert b["ok"], b["warnings"]
    for s in ("Germany", "France", "Italy", "Spain", "Euro area", "2.55"):
        assert s in b["raw_text"], s
    assert b["boxes"] and all(0 <= v <= 2000 for bx in b["boxes"] for v in bx["box"])
    assert "table" not in b["text"].splitlines()


def test_free_ocr_known_text(http: httpx.Client, tmp_path) -> None:
    text = "The quick brown fox 2026 识别测试 abc 98765"
    p = tmp_path / "known.png"
    render_text_image(text, width=1400).save(p)
    b = ocr(http, p, "free")
    assert char_recall(text, b["text"]) >= 0.9, b["text"]


@pytest.mark.parametrize("mode", ["ocr", "figure", "describe"])
def test_other_modes_nonempty(http: httpx.Client, mode: str) -> None:
    b = ocr(http, SAMPLES / "sample.png", mode)
    assert b["content_chars"] > 10 and not any(w["code"] == "empty_output" for w in b["warnings"])


def test_find_mode_boxes(http: httpx.Client) -> None:
    b = ocr(http, SAMPLES / "sample.png", "find", find_term="Germany")
    assert b["boxes"], b
    assert any("germany" in x["label"].lower() for x in b["boxes"])


def test_large_photo_crops(http: httpx.Client) -> None:
    # 4096×3072 走动态切片（6 块局部视图）
    b = ocr(http, SAMPLES / "sample1.jpg", "describe")
    assert b["content_chars"] > 30


def test_pdf_stream(http: httpx.Client) -> None:
    with open(SAMPLES / "sample.pdf", "rb") as f:
        r = http.post("/api/ocr/pdf", files={"file": ("s.pdf", f)}, data={"prompt_type": "document"})
    ev = [json.loads(x) for x in r.text.splitlines() if x.strip()]
    assert ev[0]["type"] == "start" and ev[-1]["type"] == "done"
    pages = [e for e in ev if e["type"] == "page"]
    assert len(pages) == ev[0]["page_count"]
    assert all(p["content_chars"] > 0 for p in pages)


def test_synthetic_pdf_page_numbers(http: httpx.Client) -> None:
    r = http.post("/api/ocr/pdf", files={"file": ("p.pdf", pdf_bytes(3))}, data={"prompt_type": "free"})
    pages = [json.loads(x) for x in r.text.splitlines() if '"type": "page"' in x]
    for e in pages:
        assert f"Page {e['page']}" in e["text"], e["text"]  # 每页带自己的编号：分页没有错位
