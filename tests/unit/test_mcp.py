"""MCP 字段名必须与 HTTP 合同一致（v4 缺陷：发 mode/search_text，后端收 prompt_type/find_term）。"""

from __future__ import annotations

import inspect

import httpx
import pytest
from fastapi.testclient import TestClient

from deepseek_ocr_webui import mcp_server
from deepseek_ocr_webui.app import api_form_fields

from ..conftest import pdf_bytes, png_bytes


def test_form_fields_match_api() -> None:
    form = mcp_server.build_form("find", "Total", "", True)
    assert set(form) - {"pages"} <= set(api_form_fields())
    assert form == {"prompt_type": "find", "find_term": "Total", "custom_prompt": "", "grounding": "true"}


def test_form_constant_matches_openapi(client: TestClient) -> None:
    spec = client.get("/openapi.json").json()
    ref = spec["paths"]["/api/ocr"]["post"]["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"]
    props = spec["components"]["schemas"][ref.rsplit("/", 1)[-1]]["properties"]
    assert set(props) == set(api_form_fields())


def test_invalid_mode() -> None:
    with pytest.raises(ValueError):
        mcp_server.build_form("search", "", "", None)


@pytest.fixture
def routed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """把 MCP 的 httpx.Client 接到 TestClient（真实 HTTP 合同，不打网络）。"""
    transport = httpx.MockTransport(lambda req: _forward(client, req))
    orig = httpx.Client

    def factory(*a, **kw):
        kw.pop("timeout", None)
        return orig(transport=transport, base_url="http://t")

    monkeypatch.setattr(mcp_server.httpx, "Client", factory)
    monkeypatch.setattr(mcp_server, "BASE", "http://t")
    return client


def _forward(client: TestClient, req: httpx.Request) -> httpx.Response:
    r = client.request(req.method, req.url.path, content=req.content, headers=dict(req.headers))
    return httpx.Response(r.status_code, headers=r.headers, content=r.content)


def test_ocr_image_end_to_end(routed: TestClient, tmp_path) -> None:
    p = tmp_path / "a.png"
    p.write_bytes(png_bytes())
    out = mcp_server.ocr_image(path=str(p), mode="find", find_term="Hello")
    assert out["ok"] is True and "Hello DeepSeek OCR" in out["text"] and len(out["boxes"]) == 1


def test_ocr_image_error_passthrough(routed: TestClient, tmp_path) -> None:
    p = tmp_path / "a.pdf"
    p.write_bytes(pdf_bytes(1))
    out = mcp_server.ocr_image(path=str(p))
    assert out["success"] is False and out["status"] == 415


def test_ocr_pdf_end_to_end(routed: TestClient, tmp_path) -> None:
    p = tmp_path / "a.pdf"
    p.write_bytes(pdf_bytes(2))
    out = mcp_server.ocr_pdf(str(p), pages="2")
    assert out["summary"]["ok_pages"] == 1 and out["pages"][0]["page"] == 2


def test_tool_params_have_no_v4_names() -> None:
    # MCP 工具参数名直接成为 schema：不许出现 v4 的 search_text
    for fn in (mcp_server.ocr_image, mcp_server.ocr_pdf):
        assert "search_text" not in inspect.signature(fn).parameters


def test_server_builds_with_installed_sdk() -> None:
    # mcp 2.x 改名 FastMCP → MCPServer 时，只测字段的单测全绿而 server 根本起不来（2026-11-07 真实握手抓到）
    pytest.importorskip("mcp.server.mcpserver")
    import asyncio

    server = mcp_server.build_server()
    tools = asyncio.run(server.list_tools())
    assert {t.name for t in tools} == {"ocr_image", "ocr_pdf", "health"}
