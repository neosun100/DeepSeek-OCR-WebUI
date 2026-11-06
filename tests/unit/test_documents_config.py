from __future__ import annotations

import pytest

from deepseek_ocr_webui.config import Limits, Settings, _legacy_overrides
from deepseek_ocr_webui.documents import load_image, parse_page_spec, plan_pdf, rasterize_pdf, sniff
from deepseek_ocr_webui.errors import InputError

from ..conftest import pdf_bytes, png_bytes


class TestSniff:
    def test_types(self) -> None:
        assert sniff(png_bytes()) == "png"
        assert sniff(pdf_bytes(1)) == "pdf"
        assert sniff(b"\xff\xd8\xff\xe0rest") == "jpeg"
        assert sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "webp"
        assert sniff(b"hello world") is None


class TestLoadImage:
    def test_ok_rgb(self) -> None:
        im = load_image(png_bytes(10, 8))
        assert im.size == (10, 8) and im.mode == "RGB"

    def test_pdf_rejected_with_hint(self) -> None:
        with pytest.raises(InputError) as e:
            load_image(pdf_bytes(1))
        assert e.value.status == 415 and "/api/ocr/pdf" in e.value.message

    def test_pixel_bomb_rejected_before_decode(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(Limits, "MAX_IMAGE_MPIX", 0.001)  # 1000 像素
        with pytest.raises(InputError) as e:
            load_image(png_bytes(100, 100))
        d = e.value.detail()
        assert e.value.status == 413 and d["error"] == "image_too_large"
        assert {"actual", "limit"} <= d.keys()  # 四要素

    def test_corrupt(self) -> None:
        with pytest.raises(InputError) as e:
            load_image(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)
        assert e.value.status == 422


class TestPdf:
    def test_page_spec(self) -> None:
        assert parse_page_spec("1-3,5", 6) == [0, 1, 2, 4]
        assert parse_page_spec("", 3) == [0, 1, 2]
        assert parse_page_spec("2,2,1", 3) == [1, 0]

    @pytest.mark.parametrize("spec", ["0", "4", "3-2", "a", "1-"])
    def test_page_spec_invalid(self, spec: str) -> None:
        with pytest.raises(InputError):
            parse_page_spec(spec, 3)

    def test_plan_and_rasterize(self) -> None:
        data = pdf_bytes(3)
        plan = plan_pdf(data, pages="2-3", max_pages=10)
        assert plan.page_count == 3 and plan.pages == [1, 2]
        out = list(rasterize_pdf(data, plan.pages))
        assert [p for p, _ in out] == [1, 2]
        im = out[0][1]
        # 144 DPI：300pt × 2 = 600 px
        assert im.size == (600, 400) and im.mode == "RGB"

    def test_encrypted(self) -> None:
        with pytest.raises(InputError) as e:
            plan_pdf(pdf_bytes(1, encrypt=True), pages=None, max_pages=10)
        assert e.value.error == "pdf_encrypted"

    def test_too_many_pages(self) -> None:
        with pytest.raises(InputError) as e:
            plan_pdf(pdf_bytes(5), pages=None, max_pages=4)
        assert e.value.status == 413 and e.value.actual == 5 and e.value.limit == 4

    def test_page_too_large(self) -> None:
        with pytest.raises(InputError) as e:
            plan_pdf(pdf_bytes(1, width=14400, height=14400), pages=None, max_pages=4)
        assert e.value.error == "page_too_large"

    def test_not_pdf(self) -> None:
        with pytest.raises(InputError) as e:
            plan_pdf(png_bytes(), pages=None, max_pages=4)
        assert e.value.status == 415


class TestSettings:
    def test_defaults_are_private(self) -> None:
        s = Settings()
        assert s.host == "127.0.0.1"  # 默认只绑本机
        assert s.cors_origins == []
        assert s.trust_proxy is False

    def test_csv_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DSOCR_CORS_ORIGINS", "http://a.com, http://b.com")
        monkeypatch.setenv("DSOCR_VLLM_URLS", '["http://x:8000"]')
        s = Settings()
        assert s.cors_origins == ["http://a.com", "http://b.com"]
        assert s.vllm_urls == ["http://x:8000"]

    def test_legacy_env_names(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PORT", "9000")
        monkeypatch.setenv("FORCE_BACKEND", "CPU")
        monkeypatch.setenv("LOCAL_MODEL_PATH", "/models/x")
        assert _legacy_overrides() == {"port": "9000", "device": "cpu", "model_path": "/models/x"}

    def test_new_env_wins_over_legacy(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PORT", "9000")
        monkeypatch.setenv("DSOCR_PORT", "9100")
        assert "port" not in _legacy_overrides()

    def test_revision_pinned(self) -> None:
        import re

        assert re.fullmatch(r"[0-9a-f]{40}", Settings().model_revision)
