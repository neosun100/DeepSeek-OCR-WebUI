"""FastAPI 应用：HTTP 合同（Swagger 即文档）。业务逻辑在 service.py。

端点总览
- `POST /api/ocr`        单张图片 OCR（v4 `/ocr` 的规范名；`/ocr` 保留为兼容别名）
- `POST /api/ocr/pdf`    PDF 逐页 OCR，NDJSON 流式返回（大文件不再一次性塞进内存 / 超时，#31）
- `GET  /health`         就绪 + 队列状态（模型加载 / 预热完成前返回 503，Docker HEALTHCHECK 可直接用）
- `GET  /health/live`    存活探针（进程活着就 200）
- `GET  /api/capabilities` 模式、限额、引擎、已知弱项
- `POST /pdf-to-images`  v4 兼容：PDF → 页图（deprecated，有页数上限）
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from . import __version__
from .config import Limits, Settings, get_settings
from .documents import load_image, plan_pdf, rasterize_pdf
from .engines import Engine, create_engine
from .errors import InputError, ServiceError, install_handlers
from .logs import setup_logging
from .prompts import MAX_CUSTOM_PROMPT_CHARS, MAX_FIND_TERM_CHARS, MODES
from .schemas import CapabilitiesResponse, HealthResponse, OCRResponse
from .service import OCRService, PageRequest, new_request_id, valid_client_id

HEARTBEAT_S = 15.0

# /api/ocr 的表单字段（MCP 客户端按它组请求）；与 OpenAPI 实际生成的字段一致由合同测试核验
OCR_FORM_FIELDS = ("file", "prompt_type", "find_term", "custom_prompt", "grounding")


def api_form_fields() -> tuple[str, ...]:
    return OCR_FORM_FIELDS


# 表单参数类型别名（模块级：from __future__ annotations 下 FastAPI 按名字在模块全局里解析注解）
form_file = Annotated[UploadFile, File(description="图片文件")]
form_mode = Annotated[str, Form(description="识别模式")]
form_find = Annotated[str, Form(description="find 模式关键词")]
form_custom = Annotated[str, Form(description="freeform 模式提示词")]
form_grounding = Annotated[bool | None, Form(description="是否输出版面框（不传 = 模式默认）")]

# 模型能力的诚实声明（来源：aws-gpu docs/research/unlimited-ocr/RIVALS.md / BENCH.md 引用的公开榜单）
KNOWN_WEAK = [
    {
        "area": "拍照 / 透视畸变 / 倾斜",
        "evidence": "Real5-OmniDocBench Overall 73.01（Warping 66.5 · Skew 61.3）",
    },
    {"area": "手写体", "evidence": "WildHandBench DeepSeek-OCR2 = 9.46"},
    {"area": "低资源语种", "evidence": "MDPBench DeepSeek-OCR(v1) = 51.8"},
]


def _client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"


async def _read_upload(file: UploadFile, settings: Settings) -> bytes:
    """读取上传，超过上限立即拒绝（读 cap+1 字节判定，不把超大文件整个读进内存）。"""
    cap = settings.max_upload_bytes
    data = await file.read(cap + 1)
    if len(data) > cap:
        raise InputError(
            413, "file_too_large", "上传文件超过大小上限",
            actual=f">{settings.max_upload_mb} MB", limit=f"{settings.max_upload_mb} MB",
        )  # fmt: skip
    if not data:
        raise InputError(422, "empty_file", "上传的文件为空")
    return data


def _page_request(
    prompt_type: str, find_term: str, custom_prompt: str, grounding: bool | None
) -> PageRequest:
    if prompt_type not in MODES:
        raise InputError(422, "invalid_mode", "不支持的识别模式", actual=prompt_type, limit=list(MODES))
    if prompt_type == "find" and not find_term.strip():
        # v4 静默默认搜 "Total"；没给关键词就是调用方错误
        raise InputError(422, "missing_find_term", "find 模式需要 find_term（要查找的关键词）")
    if len(find_term) > MAX_FIND_TERM_CHARS:
        raise InputError(
            422, "find_term_too_long", "查找关键词过长", actual=len(find_term), limit=MAX_FIND_TERM_CHARS
        )
    if len(custom_prompt) > MAX_CUSTOM_PROMPT_CHARS:
        raise InputError(
            422, "custom_prompt_too_long", "自定义提示词过长",
            actual=len(custom_prompt), limit=MAX_CUSTOM_PROMPT_CHARS,
        )  # fmt: skip
    return PageRequest(prompt_type, find_term, custom_prompt, grounding)


def _find_frontend(settings: Settings) -> Path | None:
    candidates = [settings.frontend_dist] if settings.frontend_dist else []
    candidates += [str(Path(__file__).resolve().parents[2] / "frontend" / "dist")]
    for c in candidates:
        if c and (Path(c) / "index.html").is_file():
            return Path(c)
    return None


def create_app(settings: Settings | None = None, engine: Engine | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.log_level, settings.log_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        eng = engine or create_engine(settings)
        svc = OCRService(settings, eng)
        app.state.service = svc
        logger.info("DeepSeek-OCR-WebUI {} 启动：engine={} host={} port={}", __version__, eng.name,
                    settings.host, settings.port)  # fmt: skip
        svc.start_background()  # 加载在后台：/health 立刻可答（503 starting），不阻塞启动
        yield
        await svc.close()

    app = FastAPI(
        title="DeepSeek-OCR-WebUI API",
        version=__version__,
        description=(
            "自托管的 DeepSeek-OCR-2 服务。引擎：vLLM（CUDA，连续批处理）或 transformers（CUDA / Apple Silicon / CPU）。\n\n"
            f"**限额**：单文件 ≤ {settings.max_upload_mb} MB · 图片 ≤ {Limits.MAX_IMAGE_MPIX} MP · "
            f"PDF 单次 ≤ {settings.max_pdf_pages} 页（{Limits.PDF_DPI} DPI 栅格化，每页 ≤ {Limits.MAX_PAGE_MPIX} MP）· "
            f"单页生成 ≤ {settings.max_new_tokens} token · 单请求超时 {settings.request_timeout_s:.0f}s。\n\n"
            '**错误格式**：`{"success": false, "detail": {"error", "message", "actual", "limit"}, "request_id"}`。\n\n'
            "**产物判据**：每页返回 `ok` 与 `warnings[]`（repetition / repetition_cut / truncated / coordinate_loop / "
            "bbox_invalid / empty_output / near_empty）。HTTP 200 只代表请求被处理，请以 `ok` 判断产物是否可信。"
        ),
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    install_handlers(app)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,  # 不用 cookie；v4 的 "*" + credentials 组合会被浏览器拒绝且不安全
            allow_methods=["GET", "POST"],
            allow_headers=["content-type", "x-client-id", "x-request-id"],
            expose_headers=["x-request-id", "retry-after"],
        )

    @app.middleware("http")
    async def _request_context(request: Request, call_next: Any) -> Any:
        rid = request.headers.get("x-request-id")
        rid = rid if rid and valid_client_id(rid) else new_request_id()
        request.state.request_id = rid
        t0 = time.monotonic()
        with logger.contextualize(request_id=rid):
            response = await call_next(request)
            if not request.url.path.startswith(("/assets", "/health")):
                logger.info("{} {} {} {:.0f}ms", request.method, request.url.path, response.status_code,
                            (time.monotonic() - t0) * 1000)  # fmt: skip
        response.headers["x-request-id"] = rid
        response.headers.setdefault("x-content-type-options", "nosniff")
        return response

    def svc(request: Request) -> OCRService:
        return request.app.state.service

    # ------------------------------------------------------------- health
    @app.get(
        "/health",
        summary="就绪与队列状态",
        description="模型加载与预热完成前返回 **503**（`status=starting|error`）；就绪后 200，"
        "`status` ∈ healthy / busy / full。带 `X-Client-ID` 头时返回该客户端的排队位置。",
        response_model=HealthResponse,
        responses={503: {"description": "加载中或不可用"}},
        tags=["health"],
    )
    async def health(request: Request) -> JSONResponse:
        body = svc(request).health(valid_client_id(request.headers.get("x-client-id")))
        return JSONResponse(body, status_code=200 if body["ready"] else 503)

    @app.get("/health/live", summary="存活探针", description="进程存活即返回 200。", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "alive", "version": __version__}

    @app.get(
        "/api/capabilities",
        summary="能力声明",
        description="识别模式、限额、当前引擎与已知弱项（附公开榜单证据）。",
        response_model=CapabilitiesResponse,
        tags=["meta"],
    )
    async def capabilities(request: Request) -> dict[str, Any]:
        s = svc(request)
        return {
            "version": __version__,
            "model": {"id": settings.model_id, "revision": settings.model_revision},
            "engine": s.engine.info(),
            "modes": {
                k: {
                    "summary": v.summary,
                    "grounding_default": v.grounding_default,
                    "grounding_switchable": v.grounding_allowed,
                }
                for k, v in MODES.items()
            },
            "limits": {
                "max_upload_mb": settings.max_upload_mb,
                "max_image_mpix": Limits.MAX_IMAGE_MPIX,
                "max_pdf_pages": settings.max_pdf_pages,
                "max_page_mpix": Limits.MAX_PAGE_MPIX,
                "pdf_dpi": Limits.PDF_DPI,
                "max_new_tokens": settings.max_new_tokens,
                "request_timeout_s": settings.request_timeout_s,
                "max_queue": settings.max_queue,
                "max_per_client": settings.max_per_client,
                "max_per_ip": settings.max_per_ip,
                "max_find_term_chars": MAX_FIND_TERM_CHARS,
                "max_custom_prompt_chars": MAX_CUSTOM_PROMPT_CHARS,
            },
            "known_weak": KNOWN_WEAK,
            "inputs": {"images": ["png", "jpeg", "webp", "bmp", "tiff", "gif"], "documents": ["pdf"]},
        }

    # ---------------------------------------------------------------- OCR
    ocr_description = (
        "上传一张图片（PNG/JPEG/WebP/BMP/TIFF/GIF，按文件头识别），返回识别文本、原始输出（含 grounding 标记）、"
        "版面框（像素坐标）与逐页判据。\n\n"
        "- `prompt_type`：document（默认）· ocr · free · figure · describe · find · freeform\n"
        "- `find_term`：find 模式的关键词 · `custom_prompt`：freeform 模式的提示词\n"
        "- `grounding`：document / ocr / freeform 可切换是否输出版面框；不传 = 模式默认\n"
        "- 头 `X-Client-ID`：同一客户端的并发上限与排队位置"
    )

    async def _ocr(
        request: Request,
        file: UploadFile,
        prompt_type: str,
        find_term: str,
        custom_prompt: str,
        grounding: bool | None,
    ) -> dict[str, Any]:
        s = svc(request)
        req = _page_request(prompt_type, find_term, custom_prompt, grounding)
        s.require_ready()  # 未就绪时先 503，不读上传
        data = await _read_upload(file, settings)
        image = await asyncio.to_thread(load_image, data)
        rid = request.state.request_id
        async with s.admitted(
            valid_client_id(request.headers.get("x-client-id")), _client_ip(request, settings), rid
        ):
            result = await s.ocr_image(image, req, is_disconnected=request.is_disconnected)
        result["request_id"] = rid
        return result

    @app.post(
        "/api/ocr", summary="图片 OCR", description=ocr_description, response_model=OCRResponse, tags=["ocr"],
        responses={413: {"description": "文件 / 像素超限"}, 415: {"description": "不支持的类型"},
                   422: {"description": "参数不合法"}, 429: {"description": "排队已满 / 并发超限"},
                   503: {"description": "模型加载中 / 显存不足"}, 504: {"description": "推理超时"}},
    )  # fmt: skip
    async def api_ocr(
        request: Request,
        file: form_file,
        prompt_type: form_mode = "document",
        find_term: form_find = "",
        custom_prompt: form_custom = "",
        grounding: form_grounding = None,
    ) -> dict[str, Any]:
        return await _ocr(request, file, prompt_type, find_term, custom_prompt, grounding)

    @app.post(
        "/ocr", summary="图片 OCR（v4 兼容别名）", description="与 `/api/ocr` 完全相同。", deprecated=True,
        response_model=OCRResponse, tags=["compat"],
    )  # fmt: skip
    async def legacy_ocr(
        request: Request,
        file: form_file,
        prompt_type: form_mode = "document",
        find_term: form_find = "",
        custom_prompt: form_custom = "",
        grounding: form_grounding = None,
    ) -> dict[str, Any]:
        return await _ocr(request, file, prompt_type, find_term, custom_prompt, grounding)

    @app.post(
        "/api/ocr/pdf",
        summary="PDF 逐页 OCR（NDJSON 流）",
        description=(
            "逐页栅格化（144 DPI）并识别，`application/x-ndjson` 每行一个事件：\n\n"
            '- `{"type":"start","page_count","pages":[1,2,…]}`\n'
            '- `{"type":"page","page":1, …与 /api/ocr 相同的字段}`（按页序输出）\n'
            '- `{"type":"heartbeat"}`（每 15 s，防反向代理空闲断开）\n'
            '- `{"type":"error","page","detail"}`（单页失败不中断其余页）\n'
            '- `{"type":"done","ok_pages","warned_pages","failed_pages","elapsed_s"}`\n\n'
            "`pages` 参数如 `1-3,5`；输入校验（加密 / 页数 / 像素）在开流之前完成，失败直接返回 4xx。"
        ),
        tags=["ocr"],
        responses={200: {"content": {"application/x-ndjson": {}}}},
    )
    async def api_ocr_pdf(
        request: Request,
        file: Annotated[UploadFile, File(description="PDF 文件")],
        prompt_type: form_mode = "document",
        find_term: form_find = "",
        custom_prompt: form_custom = "",
        grounding: form_grounding = None,
        pages: Annotated[str, Form(description="页码范围，如 1-3,5；空 = 全部")] = "",
    ) -> StreamingResponse:
        s = svc(request)
        req = _page_request(prompt_type, find_term, custom_prompt, grounding)
        s.require_ready()
        data = await _read_upload(file, settings)
        plan = await asyncio.to_thread(plan_pdf, data, pages=pages, max_pages=settings.max_pdf_pages)
        rid = request.state.request_id
        client_id = valid_client_id(request.headers.get("x-client-id"))
        ticket = s.admission.acquire(client_id, _client_ip(request, settings), rid)  # 开流前判限流 ⇒ 429 可见

        async def gen() -> AsyncIterator[bytes]:
            t0 = time.monotonic()
            counts = {"ok": 0, "warned": 0, "failed": 0}
            try:
                yield _line({"type": "start", "request_id": rid, "page_count": plan.page_count,
                             "pages": [p + 1 for p in plan.pages]})  # fmt: skip
                async for event in _pdf_pages(s, data, plan.pages, req, request):
                    if event.get("type") == "page":
                        counts["ok" if event.get("ok") else "warned"] += 1
                    elif event.get("type") == "error":
                        counts["failed"] += 1
                    yield _line(event)
                yield _line({"type": "done", "ok_pages": counts["ok"], "warned_pages": counts["warned"],
                             "failed_pages": counts["failed"], "elapsed_s": round(time.monotonic() - t0, 2)})  # fmt: skip
            finally:
                s.admission.release(ticket)

        return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"x-request-id": rid})

    @app.post(
        "/pdf-to-images",
        summary="PDF → 页图（v4 兼容）",
        description=f"返回每页 base64 PNG。deprecated：大文件请用 `/api/ocr/pdf`。上限 {settings.max_pdf_pages} 页。",
        deprecated=True,
        tags=["compat"],
    )
    async def legacy_pdf_to_images(file: Annotated[UploadFile, File()]) -> dict[str, Any]:
        data = await _read_upload(file, settings)
        plan = await asyncio.to_thread(plan_pdf, data, pages=None, max_pages=settings.max_pdf_pages)

        def render() -> list[dict[str, Any]]:
            out = []
            for p, im in rasterize_pdf(data, plan.pages):
                buf = io.BytesIO()
                im.save(buf, format="PNG", optimize=True)
                out.append({
                    "data": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                    "name": f"page_{p + 1}.png", "width": im.size[0], "height": im.size[1], "page_number": p + 1,
                })  # fmt: skip
            return out

        images = await asyncio.to_thread(render)
        return {
            "success": True,
            "images": images,
            "page_count": len(images),
            "original_filename": file.filename,
        }

    # ----------------------------------------------------------- frontend
    dist = _find_frontend(settings)
    if dist is not None:
        for item in dist.iterdir():
            if item.is_dir():
                app.mount(f"/{item.name}", StaticFiles(directory=str(item)), name=f"static-{item.name}")
        top_files = {p.name for p in dist.iterdir() if p.is_file() and p.name != "index.html"}

        @app.get("/", include_in_schema=False)
        async def index() -> FileResponse:
            return FileResponse(dist / "index.html")

        @app.get("/{name}", include_in_schema=False)
        async def top_level(name: str) -> FileResponse:
            if name not in top_files:  # 白名单：只服务 dist 顶层真实存在的文件，不做任意路径拼接
                raise InputError(404, "not_found", "资源不存在", actual=name)
            return FileResponse(dist / name)
    else:

        @app.get("/", include_in_schema=False)
        async def index_missing() -> HTMLResponse:
            return HTMLResponse(
                "<h1>DeepSeek-OCR-WebUI</h1><p>前端未构建（frontend/dist 不存在）。API 文档：<a href='/docs'>/docs</a>。"
                "构建：<code>cd frontend && npm ci && npm run build</code></p>"
            )

    return app


def _line(obj: dict[str, Any]) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode()


async def _pdf_pages(
    s: OCRService, data: bytes, pages: list[int], req: PageRequest, request: Request
) -> AsyncIterator[dict[str, Any]]:
    """按页序产出事件；最多预取 engine.max_concurrency 页并行推理（vLLM 合批），HF 时等价于串行。"""
    lookahead = max(1, min(s.engine.max_concurrency, 8))
    page_iter = iter(rasterize_pdf(data, pages))
    pending: list[tuple[int, asyncio.Task[dict[str, Any]]]] = []

    async def run(p: int, im: Any) -> dict[str, Any]:
        return await s.ocr_image(im, req)

    async def fill() -> None:
        while len(pending) < lookahead:
            nxt = await asyncio.to_thread(next, page_iter, None)
            if nxt is None:
                return
            p, im = nxt
            pending.append((p, asyncio.create_task(run(p, im))))

    try:
        await fill()
        while pending:
            p, task = pending[0]
            while True:
                done, _ = await asyncio.wait({task}, timeout=HEARTBEAT_S)
                if done:
                    break
                yield {"type": "heartbeat"}
                if await request.is_disconnected():
                    logger.info("客户端断开，停止 PDF 后续页")
                    return
            pending.pop(0)
            try:
                result = task.result()
                yield {"type": "page", "page": p + 1, **result}
            except ServiceError as e:
                yield {"type": "error", "page": p + 1, "detail": e.detail()}
            except Exception as e:  # noqa: BLE001 —— 单页失败不中断整本；完整栈进日志并作为 error 事件返回
                logger.opt(exception=e).error("PDF 第 {} 页失败", p + 1)
                yield {
                    "type": "error",
                    "page": p + 1,
                    "detail": {"error": "internal_error", "message": str(e)[:300]},
                }
            if await request.is_disconnected():
                logger.info("客户端断开，停止 PDF 后续页")
                return
            await fill()
    finally:
        for _, t in pending:
            t.cancel()
