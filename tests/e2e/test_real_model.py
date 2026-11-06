"""真实权重 + 本机加速器（CUDA / MPS）：`DSOCR_REAL_MODEL=1 uv run pytest tests/e2e/test_real_model.py`。

守的是 HFEngine 的设备无关推理（上游写死 .cuda() 的绕行）在真实设备上产物正确。
"""

from __future__ import annotations

import asyncio
import os

import pytest
from PIL import Image

pytestmark = [pytest.mark.gpu, pytest.mark.timeout(1800)]

if os.environ.get("DSOCR_REAL_MODEL") != "1":
    pytest.skip("DSOCR_REAL_MODEL=1 才跑（需要权重与加速器）", allow_module_level=True)

from deepseek_ocr_webui.config import Settings  # noqa: E402
from deepseek_ocr_webui.engines import create_engine, resolve_device  # noqa: E402
from deepseek_ocr_webui.prompts import build_prompt  # noqa: E402
from deepseek_ocr_webui.service import char_recall, render_text_image  # noqa: E402

from ..conftest import SAMPLES  # noqa: E402


@pytest.fixture(scope="module")
def engine():
    s = Settings(engine=os.environ.get("DSOCR_ENGINE", "hf"))  # type: ignore[arg-type]
    e = create_engine(s)
    asyncio.run(e.load())
    yield e
    asyncio.run(e.close())


def run(engine, image: Image.Image, mode: str = "document"):
    return asyncio.run(engine.infer(image, build_prompt(mode), max_tokens=4096))


def test_device_is_accelerated() -> None:
    assert resolve_device(Settings()) in ("cuda", "mps")


def test_table(engine) -> None:
    out = run(engine, Image.open(SAMPLES / "sample.png").convert("RGB"))
    assert out.finish_reason == "stop"
    for s in ("Germany", "Euro area", "2.55"):
        assert s in out.text


def test_known_text_recall(engine) -> None:
    text = "DeepSeek OCR 2 on device 识别测试 2026 xyz"
    out = run(engine, render_text_image(text, width=1200), "free")
    assert char_recall(text, out.text) >= 0.9, out.text


def test_crop_path(engine) -> None:
    out = run(engine, Image.open(SAMPLES / "sample1.jpg").convert("RGB"), "describe")
    assert len(out.text) > 30


def test_tensor_cuda_restored(engine) -> None:
    import torch

    run(engine, render_text_image("restore check"), "free")
    assert torch.Tensor.cuda.__qualname__ == "TensorBase.cuda" or "lambda" not in repr(torch.Tensor.cuda)
