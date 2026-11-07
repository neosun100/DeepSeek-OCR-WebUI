"""共享 fixture。

三层测试各守什么：
- unit/       纯函数 + HTTP 合同（FakeEngine，无模型、无 GPU）。守：判据、错误四要素、限流、流式协议。守不住：真实模型产物。
- regression/ 钉住已发生过的缺陷（AST / 文本扫描）。守：缺陷不回归。守不住：新类型缺陷。
- e2e/        打真实服务（DSOCR_BASE）或真实权重（DSOCR_REAL_MODEL=1）。守：真产物质量。不可达时 skip（skip ≠ 通过，CI 报告里可见）。
"""

from __future__ import annotations

import io
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from deepseek_ocr_webui.app import create_app
from deepseek_ocr_webui.config import Settings
from deepseek_ocr_webui.engines.fake import FakeEngine
from deepseek_ocr_webui.service import WARMUP_TEXT

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "frontend" / "tests" / "e2e" / "samples"


def png_bytes(w: int = 64, h: int = 48, color: str = "white") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def pdf_bytes(n_pages: int = 3, *, encrypt: bool = False, width: float = 300, height: float = 200) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    for i in range(n_pages):
        page = doc.new_page(width=width, height=height)
        page.insert_text((20, 40), f"Page {i + 1} hello", fontsize=14)
    kw = {}
    if encrypt:
        kw = {"encryption": pymupdf.PDF_ENCRYPT_AES_256, "user_pw": "u", "owner_pw": "o"}
    data = doc.tobytes(**kw)
    doc.close()
    return data


def make_settings(**kw: object) -> Settings:
    base: dict[str, object] = {"engine": "fake", "warmup": True, "log_level": "WARNING"}
    base.update(kw)
    return Settings(**base)  # type: ignore[arg-type]


def wait_ready(client: TestClient, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get("/health")
        body = r.json()
        if body["status"] not in ("starting",):
            return body
        time.sleep(0.02)
    raise AssertionError("服务未在超时内离开 starting 状态")


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine(warmup_text=WARMUP_TEXT)


@pytest.fixture
def client(engine: FakeEngine) -> Iterator[TestClient]:
    app = create_app(make_settings(), engine=engine)
    with TestClient(app, raise_server_exceptions=False) as c:
        body = wait_ready(c)
        assert body["ready"], body
        yield c
