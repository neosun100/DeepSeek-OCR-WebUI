"""HTTP 合同：FakeEngine 驱动，覆盖成功形状、每类错误的四要素、限流、PDF 流式协议、健康状态机。"""

from __future__ import annotations

import json
import threading

import pytest
from fastapi.testclient import TestClient

from deepseek_ocr_webui.app import create_app
from deepseek_ocr_webui.engines.fake import FakeEngine
from deepseek_ocr_webui.service import WARMUP_TEXT

from ..conftest import make_settings, pdf_bytes, png_bytes, wait_ready


def post_ocr(client: TestClient, w: int = 64, h: int = 48, path: str = "/api/ocr", **data: str):
    return client.post(path, files={"file": ("x.png", png_bytes(w, h), "image/png")}, data=data)


def assert_four_elements(body: dict, error: str) -> None:
    assert body["success"] is False
    d = body["detail"]
    assert d["error"] == error and d["message"]
    assert body["request_id"]


# ------------------------------------------------------------------ success
class TestOCRSuccess:
    def test_shape(self, client: TestClient) -> None:
        r = post_ocr(client)
        assert r.status_code == 200
        b = r.json()
        for k in ("success", "ok", "text", "raw_text", "boxes", "image_dims", "prompt_type", "finish_reason",
                  "warnings", "content_chars", "metadata", "request_id"):  # fmt: skip
            assert k in b, k
        assert b["ok"] is True and b["warnings"] == []
        assert b["image_dims"] == {"w": 64, "h": 48}
        assert b["boxes"][0]["label"] == "title"
        assert "title" not in b["text"].splitlines()  # 版面类型词不进显示文本
        assert "Hello DeepSeek OCR" in b["text"]
        assert b["metadata"]["engine"] == "fake"
        assert r.headers["x-request-id"] == b["request_id"]

    def test_legacy_alias_identical_shape(self, client: TestClient) -> None:
        a = post_ocr(client).json()
        b = post_ocr(client, path="/ocr").json()
        assert set(a) == set(b)

    def test_grounding_param_reaches_prompt(self, client: TestClient, engine: FakeEngine) -> None:
        post_ocr(client, prompt_type="document", grounding="false")
        assert "<|grounding|>" not in engine.calls[-1]["prompt"]
        post_ocr(client, prompt_type="document")
        assert "<|grounding|>" in engine.calls[-1]["prompt"]

    def test_find_mode_block_level(self, client: TestClient) -> None:
        b = post_ocr(client, 999, 999, prompt_type="find", find_term="hello deepseek").json()
        assert b["metadata"]["find"] == {
            "term": "hello deepseek",
            "strategy": "layout_block_search",
            "matched_blocks": 1,
        }
        assert [x["label"] for x in b["boxes"]] == ["hello deepseek"]
        assert b["boxes"][0]["box"] == [100, 150, 900, 400]  # 命中的是 text 块，不是 title 块
        assert "Hello DeepSeek OCR" in b["text"] and "Fake Title" not in b["text"]

    def test_find_no_match_is_a_reading(self, client: TestClient) -> None:
        b = post_ocr(client, prompt_type="find", find_term="不存在的词").json()
        assert b["boxes"] == [] and b["ok"] is True
        assert "find_no_match" in {w["code"] for w in b["warnings"]}

    def test_find_requires_term(self, client: TestClient) -> None:
        r = post_ocr(client, prompt_type="find")
        assert r.status_code == 422 and r.json()["detail"]["error"] == "missing_find_term"

    def test_request_id_propagated(self, client: TestClient) -> None:
        r = client.post("/api/ocr", files={"file": ("x.png", png_bytes(), "image/png")},
                        headers={"X-Request-ID": "my-trace-01"})  # fmt: skip
        assert r.headers["x-request-id"] == "my-trace-01" and r.json()["request_id"] == "my-trace-01"


# ----------------------------------------------------------- bad products
class TestProductJudges:
    def test_repetition_flagged_and_trimmed(self, client: TestClient) -> None:
        b = post_ocr(client, 13, 10).json()
        assert b["ok"] is False
        w = next(x for x in b["warnings"] if x["code"] == "repetition")
        assert w["trimmed_chars"] > 1000
        assert b["raw_text"].count("重复的一句话") <= 3  # 导出用的 raw_text 不带上千字复读

    def test_coord_loop(self, client: TestClient) -> None:
        b = post_ocr(client, 17, 10).json()
        assert "coordinate_loop" in {w["code"] for w in b["warnings"]}

    def test_empty(self, client: TestClient) -> None:
        b = post_ocr(client, 19, 10).json()
        assert b["ok"] is False and "empty_output" in {w["code"] for w in b["warnings"]}

    def test_truncated(self, client: TestClient) -> None:
        b = post_ocr(client, 31, 10).json()
        assert b["finish_reason"] == "length" and "truncated" in {w["code"] for w in b["warnings"]}


# ----------------------------------------------------------------- errors
class TestErrors:
    def test_oom_is_503_retryable(self, client: TestClient) -> None:
        r = post_ocr(client, 23, 10)
        assert r.status_code == 503 and r.headers.get("retry-after")
        assert_four_elements(r.json(), "backend_oom")

    def test_unexpected_is_500_not_swallowed(self, client: TestClient) -> None:
        r = post_ocr(client, 29, 10)
        assert r.status_code == 500
        assert_four_elements(r.json(), "internal_error")
        assert "fake engine exploded" in r.json()["detail"]["message"]

    def test_pdf_to_image_endpoint_415(self, client: TestClient) -> None:
        r = client.post("/api/ocr", files={"file": ("a.pdf", pdf_bytes(1), "application/pdf")})
        assert r.status_code == 415
        assert_four_elements(r.json(), "unsupported_media_type")

    def test_invalid_mode_422(self, client: TestClient) -> None:
        r = post_ocr(client, prompt_type="nope")
        assert r.status_code == 422
        d = r.json()["detail"]
        assert d["actual"] == "nope" and "document" in d["limit"]

    def test_find_term_too_long(self, client: TestClient) -> None:
        r = post_ocr(client, prompt_type="find", find_term="x" * 201)
        assert r.status_code == 422 and r.json()["detail"]["limit"] == 200

    def test_missing_file_validation_error_shape(self, client: TestClient) -> None:
        r = client.post("/api/ocr", data={"prompt_type": "document"})
        assert r.status_code == 422
        assert_four_elements(r.json(), "invalid_request")

    def test_file_too_large(self, engine: FakeEngine) -> None:
        app = create_app(make_settings(max_upload_mb=1), engine=engine)
        with TestClient(app, raise_server_exceptions=False) as c:
            wait_ready(c)
            big = png_bytes() + b"\x00" * (1024 * 1024 + 10)
            r = c.post("/api/ocr", files={"file": ("x.png", big, "image/png")})
            assert r.status_code == 413
            assert r.json()["detail"]["limit"] == "1 MB"

    def test_empty_file(self, client: TestClient) -> None:
        r = client.post("/api/ocr", files={"file": ("x.png", b"", "image/png")})
        assert r.status_code == 422 and r.json()["detail"]["error"] == "empty_file"


# ------------------------------------------------------------ admission
class TestAdmission:
    def _concurrent(self, client: TestClient, n: int, headers: dict[str, str]) -> list[int]:
        codes: list[int] = []
        lock = threading.Lock()

        def go() -> None:
            r = client.post(
                "/api/ocr", files={"file": ("x.png", png_bytes(37, 10), "image/png")}, headers=headers
            )
            with lock:
                codes.append(r.status_code)

        ts = [threading.Thread(target=go) for _ in range(n)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        return sorted(codes)

    def test_client_limit(self, client: TestClient) -> None:
        codes = self._concurrent(client, 3, {"X-Client-ID": "client-a"})
        assert codes.count(200) >= 1 and 429 in codes

    def test_client_limit_message_keeps_v4_phrase(self, client: TestClient) -> None:
        # 旧前端缓存按 "Client at max" 字符串分辨原因
        holder: list = []
        t = threading.Thread(target=lambda: holder.append(
            client.post("/api/ocr", files={"file": ("x.png", png_bytes(37, 10), "image/png")},
                        headers={"X-Client-ID": "client-b"})))  # fmt: skip
        t.start()
        import time

        time.sleep(0.15)  # 慢请求（0.5 s）在途时，同一 Client-ID 再发一个
        r2 = client.post("/api/ocr", files={"file": ("x.png", png_bytes(), "image/png")},
                         headers={"X-Client-ID": "client-b"})  # fmt: skip
        t.join()
        assert holder[0].status_code == 200
        assert r2.status_code == 429
        assert r2.json()["detail"]["error"] == "client_limit"
        assert "Client at max" in r2.json()["detail"]["message"]

    def test_queue_full(self, engine: FakeEngine) -> None:
        app = create_app(make_settings(max_queue=1, max_per_ip=10), engine=engine)
        with TestClient(app, raise_server_exceptions=False) as c:
            wait_ready(c)
            codes = self._concurrent(c, 3, {})
            assert 429 in codes
            assert codes.count(200) >= 1

    def test_invalid_client_id_ignored(self, client: TestClient) -> None:
        r = client.post("/api/ocr", files={"file": ("x.png", png_bytes(), "image/png")},
                        headers={"X-Client-ID": "bad id\nwith newline"})  # fmt: skip
        assert r.status_code == 200

    @pytest.mark.parametrize(("trust", "expect"), [(False, "10.0.0.9"), (True, "1.2.3.4")])
    def test_xff_trust(self, trust: bool, expect: str) -> None:
        from types import SimpleNamespace

        from deepseek_ocr_webui.app import _client_ip

        req = SimpleNamespace(
            headers={"x-forwarded-for": "1.2.3.4, 10.0.0.1"}, client=SimpleNamespace(host="10.0.0.9")
        )
        # 默认不信任 XFF：否则任何人伪造头即可绕过按 IP 限流
        assert _client_ip(req, make_settings(trust_proxy=trust)) == expect  # type: ignore[arg-type]

    def test_slots_released_after_errors(self, client: TestClient) -> None:
        for w in (23, 29, 19):
            post_ocr(client, w, 10)
        svc = client.app.state.service  # type: ignore[attr-defined]
        assert svc.admission.depth == 0 and svc.inflight == 0


# -------------------------------------------------------------------- pdf
def ndjson(r) -> list[dict]:
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


class TestPdfStream:
    def test_events(self, client: TestClient) -> None:
        r = client.post("/api/ocr/pdf", files={"file": ("a.pdf", pdf_bytes(3), "application/pdf")},
                        data={"pages": "1,3"})  # fmt: skip
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
        ev = ndjson(r)
        assert ev[0]["type"] == "start" and ev[0]["pages"] == [1, 3] and ev[0]["page_count"] == 3
        pages = [e for e in ev if e["type"] == "page"]
        assert [p["page"] for p in pages] == [1, 3]
        assert pages[0]["image_dims"] == {"w": 600, "h": 400}
        assert ev[-1]["type"] == "done" and ev[-1]["ok_pages"] == 2

    def test_validation_before_stream(self, client: TestClient) -> None:
        r = client.post(
            "/api/ocr/pdf", files={"file": ("a.pdf", pdf_bytes(1, encrypt=True), "application/pdf")}
        )
        assert r.status_code == 422 and r.json()["detail"]["error"] == "pdf_encrypted"

    def test_admission_released_after_stream(self, client: TestClient) -> None:
        client.post("/api/ocr/pdf", files={"file": ("a.pdf", pdf_bytes(2), "application/pdf")})
        assert client.app.state.service.admission.depth == 0  # type: ignore[attr-defined]

    def test_order_preserved_with_concurrency(self) -> None:
        eng = FakeEngine(max_concurrency=4, delay_s=0.05, warmup_text=WARMUP_TEXT)
        with TestClient(create_app(make_settings(), engine=eng), raise_server_exceptions=False) as c:
            wait_ready(c)
            r = c.post("/api/ocr/pdf", files={"file": ("a.pdf", pdf_bytes(6), "application/pdf")})
            pages = [e["page"] for e in ndjson(r) if e["type"] == "page"]
            assert pages == [1, 2, 3, 4, 5, 6]
            assert eng.max_seen_inflight > 1  # 真的并行了（vLLM 合批的前提）

    def test_legacy_pdf_to_images(self, client: TestClient) -> None:
        r = client.post("/pdf-to-images", files={"file": ("a.pdf", pdf_bytes(2), "application/pdf")})
        b = r.json()
        assert b["page_count"] == 2 and b["images"][0]["data"].startswith("data:image/png;base64,")


# ----------------------------------------------------------------- health
class TestHealth:
    def test_ready(self, client: TestClient) -> None:
        r = client.get("/health")
        b = r.json()
        assert r.status_code == 200 and b["status"] == "healthy" and b["ready"] is True
        assert b["model_version"] == "DeepSeek-OCR-2"
        assert b["warmup"]["ok"] is True and b["warmup"]["recall"] >= 0.85
        assert b["model_revision"]

    def test_queue_position_for_client(self, client: TestClient) -> None:
        b = client.get("/health", headers={"X-Client-ID": "abc"}).json()
        assert b["your_queue_status"] == {"client_id": "abc", "position": None, "total_queued": 0}

    def test_starting_is_503(self) -> None:
        eng = FakeEngine(load_delay_s=1.0, warmup_text=WARMUP_TEXT)
        with TestClient(create_app(make_settings(), engine=eng), raise_server_exceptions=False) as c:
            r = c.get("/health")
            assert r.status_code == 503 and r.json()["status"] == "starting"
            r2 = post_ocr(c)
            assert r2.status_code == 503 and r2.json()["detail"]["error"] == "model_loading"
            assert c.get("/health/live").status_code == 200

    def test_load_failure_reported_not_crashed(self) -> None:
        eng = FakeEngine(fail_load="no CUDA for you", warmup_text=WARMUP_TEXT)
        with TestClient(create_app(make_settings(), engine=eng), raise_server_exceptions=False) as c:
            b = wait_ready(c)
            assert b["status"] == "error" and "no CUDA for you" in b["load_error"]
            r = post_ocr(c)
            assert r.status_code == 503 and r.json()["detail"]["error"] == "model_unavailable"

    def test_warmup_bad_product_blocks_ready(self) -> None:
        # 负对照：引擎「能跑」但产物不对（预热召回不达标）⇒ 不许 ready
        eng = FakeEngine(warmup_text="完全无关的输出")
        with TestClient(create_app(make_settings(), engine=eng), raise_server_exceptions=False) as c:
            b = wait_ready(c)
            assert b["status"] == "error" and b["warmup"]["ok"] is False
            assert "召回" in b["load_error"]


# ------------------------------------------------------------------- meta
class TestMeta:
    def test_capabilities(self, client: TestClient) -> None:
        b = client.get("/api/capabilities").json()
        assert set(b["modes"]) == {"document", "ocr", "free", "figure", "describe", "find", "freeform"}
        assert b["limits"]["max_upload_mb"] == 200
        assert b["known_weak"] and all("evidence" in x for x in b["known_weak"])

    def test_openapi_documents_every_endpoint(self, client: TestClient) -> None:
        spec = client.get("/openapi.json").json()
        for path, ops in spec["paths"].items():
            for method, op in ops.items():
                assert op.get("summary"), f"{method} {path} 缺 summary"
                assert op.get("description"), f"{method} {path} 缺 description"

    def test_openapi_has_judge_fields(self, client: TestClient) -> None:
        text = json.dumps(client.get("/openapi.json").json())
        for field in ("warnings", "finish_reason", "content_chars", "ok"):
            assert f'"{field}"' in text

    def test_no_cors_by_default(self, client: TestClient) -> None:
        r = client.get("/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in r.headers

    def test_cors_allowlist(self, engine: FakeEngine) -> None:
        app = create_app(make_settings(cors_origins=["https://good.example"]), engine=engine)
        with TestClient(app, raise_server_exceptions=False) as c:
            wait_ready(c)
            ok = c.get("/health/live", headers={"Origin": "https://good.example"})
            bad = c.get("/health/live", headers={"Origin": "https://evil.example"})
            assert ok.headers.get("access-control-allow-origin") == "https://good.example"
            assert "access-control-allow-origin" not in bad.headers
            assert ok.headers.get("access-control-allow-credentials") is None

    def test_frontend_fallback_or_index(self, client: TestClient) -> None:
        r = client.get("/")
        assert r.status_code == 200 and "DeepSeek-OCR-WebUI" in r.text

    @pytest.mark.parametrize("name", ["../pyproject.toml", "..%2Fpyproject.toml", "etc/passwd"])
    def test_no_path_traversal(self, client: TestClient, name: str) -> None:
        r = client.get(f"/{name}")
        assert r.status_code == 404 or "[project]" not in r.text
