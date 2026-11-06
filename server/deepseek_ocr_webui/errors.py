"""错误响应四要素：机器可读码 `error` · 人话 `message` · 实际值 `actual` · 限制值 `limit`。

所有对外错误都是 `{"detail": {...}}` 形状（FastAPI 惯例），旧前端读 `detail` 字符串的地方
改为读 `detail.message`；`message` 里保留 v4 的关键短语（"queue full" / "Client at max" / "IP at max"），
这样尚未刷新的旧前端缓存也能分辨限流原因。
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from loguru import logger


class ServiceError(Exception):
    """可预期的、带 HTTP 状态码的错误。"""

    def __init__(
        self,
        status: int,
        error: str,
        message: str,
        *,
        actual: Any = None,
        limit: Any = None,
        headers: dict[str, str] | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.error = error
        self.message = message
        self.actual = actual
        self.limit = limit
        self.headers = headers
        self.extra = extra

    def detail(self) -> dict[str, Any]:
        d: dict[str, Any] = {"error": self.error, "message": self.message}
        if self.actual is not None:
            d["actual"] = self.actual
        if self.limit is not None:
            d["limit"] = self.limit
        d.update(self.extra)
        return d


class InputError(ServiceError):
    """调用方的问题（4xx）。"""


class EngineError(ServiceError):
    """推理引擎的问题（5xx）。"""


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def _service_error(request: Request, exc: ServiceError) -> JSONResponse:
        level = "WARNING" if exc.status < 500 else "ERROR"
        logger.log(level, "{} {} → {} {}", request.method, request.url.path, exc.status, exc.error)
        body = {"success": False, "detail": exc.detail(), "request_id": _request_id(request)}
        return JSONResponse(body, status_code=exc.status, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errs = exc.errors()
        first = errs[0] if errs else {}
        detail = {
            "error": "invalid_request",
            "message": f"请求参数不合法：{first.get('msg', 'invalid')}",
            "actual": {"loc": list(first.get("loc", [])), "input": str(first.get("input"))[:200]},
            "errors": [{"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in errs[:10]],
        }
        return JSONResponse(
            {"success": False, "detail": detail, "request_id": _request_id(request)}, status_code=422
        )

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        # 绝不吞异常：完整栈进日志，响应只给可行动的信息（类型 + 简述），不泄漏内部路径
        logger.opt(exception=exc).error("unhandled error on {} {}", request.method, request.url.path)
        detail = {
            "error": "internal_error",
            "message": f"服务内部错误：{type(exc).__name__}: {str(exc)[:300]}",
        }
        return JSONResponse(
            {"success": False, "detail": detail, "request_id": _request_id(request)}, status_code=500
        )
