"""MCP server：让 Claude / Cursor 等 MCP 客户端调用一个运行中的 DeepSeek-OCR-WebUI 服务。

v4 的 mcp_server.py 发的是 `mode` / `search_text`，后端收的是 `prompt_type` / `find_term` ⇒ 一直在用默认参数。
这里直接复用 HTTP 合同（字段名由 tests/unit/test_mcp.py 钉住）。

运行：`uv run --extra mcp deepseek-ocr-webui-mcp`（stdio）。服务地址 `DSOCR_BASE`，默认 http://127.0.0.1:8001。
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

import httpx

BASE = os.environ.get("DSOCR_BASE", "http://127.0.0.1:8001").rstrip("/")
TIMEOUT = float(os.environ.get("DSOCR_MCP_TIMEOUT", "900"))
MODES = ("document", "ocr", "free", "figure", "describe", "find", "freeform")


def _load(path: str | None, image_base64: str | None) -> tuple[str, bytes]:
    if path:
        p = Path(path).expanduser()
        if not p.is_file():
            raise ValueError(f"文件不存在：{p}")
        return p.name, p.read_bytes()
    if image_base64:
        data = image_base64.split(",", 1)[-1]  # 兼容 data: URL
        return "image", base64.b64decode(data)
    raise ValueError("需要 path 或 image_base64 之一")


def build_form(mode: str, find_term: str, custom_prompt: str, grounding: bool | None) -> dict[str, str]:
    if mode not in MODES:
        raise ValueError(f"mode 必须是 {MODES} 之一，收到 {mode!r}")
    form = {"prompt_type": mode, "find_term": find_term, "custom_prompt": custom_prompt}
    if grounding is not None:
        form["grounding"] = "true" if grounding else "false"
    return form


def _summarize(page: dict[str, Any]) -> dict[str, Any]:
    return {
        k: page.get(k)
        for k in ("page", "ok", "text", "warnings", "finish_reason", "boxes", "image_dims", "request_id")
        if k in page
    }


def ocr_image(
    path: str | None = None,
    image_base64: str | None = None,
    mode: str = "document",
    find_term: str = "",
    custom_prompt: str = "",
    grounding: bool | None = None,
) -> dict[str, Any]:
    name, data = _load(path, image_base64)
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(
            f"{BASE}/api/ocr",
            files={"file": (name, data)},
            data=build_form(mode, find_term, custom_prompt, grounding),
        )
    body = r.json()
    if r.status_code != 200:
        return {"success": False, "status": r.status_code, "detail": body.get("detail")}
    return _summarize(body)


def ocr_pdf(
    path: str, mode: str = "document", pages: str = "", grounding: bool | None = None
) -> dict[str, Any]:
    name, data = _load(path, None)
    form = build_form(mode, "", "", grounding) | {"pages": pages}
    out: list[dict[str, Any]] = []
    done: dict[str, Any] = {}
    with (
        httpx.Client(timeout=TIMEOUT) as c,
        c.stream("POST", f"{BASE}/api/ocr/pdf", files={"file": (name, data)}, data=form) as r,
    ):
        if r.status_code != 200:
            return {"success": False, "status": r.status_code, "detail": json.loads(r.read()).get("detail")}
        for line in r.iter_lines():
            if not line.strip():
                continue
            ev = json.loads(line)
            if ev["type"] in ("page", "error"):
                out.append(_summarize(ev) if ev["type"] == "page" else ev)
            elif ev["type"] == "done":
                done = ev
    return {"success": True, "summary": done, "pages": out}


def health() -> dict[str, Any]:
    with httpx.Client(timeout=15) as c:
        return c.get(f"{BASE}/health").json()


def build_server():  # type: ignore[no-untyped-def]
    try:
        # mcp 2.x：FastMCP 改名为 MCPServer（1.x 写法在 2.x 上 import 即失败 —— 2026-11-07 真实握手抓到）
        from mcp.server.mcpserver import MCPServer
    except ImportError as e:
        raise SystemExit("需要 mcp>=2.3：uv sync --extra mcp") from e

    server = MCPServer(
        "deepseek-ocr", instructions="DeepSeek-OCR-2 文档 / 图片 OCR（连接 DSOCR_BASE 指向的服务）"
    )
    server.add_tool(
        ocr_image,
        description="对一张图片做 OCR（DeepSeek-OCR-2）。path 为本地文件路径，或给 image_base64。mode: "
        + " / ".join(MODES),
    )
    server.add_tool(
        ocr_pdf, description="对 PDF 逐页 OCR，pages 形如 '1-3,5'（空 = 全部）。返回每页文本与产物警告。"
    )
    server.add_tool(health, description="查询 OCR 服务状态（是否就绪、引擎、队列）。")
    return server


def main() -> None:
    build_server().run()


if __name__ == "__main__":
    main()
