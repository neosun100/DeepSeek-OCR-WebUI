"""loguru 统一日志：stderr + 可选文件轮转；每个请求带 request_id。

uvicorn / transformers 等用标准库 logging 的第三方日志也被拦截进 loguru，保证一处格式、一处落盘。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from loguru import logger

_FMT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <7}</level> | "
    "<cyan>{extra[request_id]}</cyan> | {message}"
)


class _InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: str | int = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        logger.opt(depth=6, exception=record.exc_info).log(level, record.getMessage())


def setup_logging(level: str = "INFO", log_dir: str | None = None) -> None:
    logger.remove()
    logger.configure(extra={"request_id": "-"})
    logger.add(sys.stderr, level=level, format=_FMT, backtrace=False, diagnose=False)
    if log_dir:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        logger.add(
            Path(log_dir) / "deepseek-ocr-webui.log",
            level=level,
            format=_FMT,
            rotation="50 MB",
            retention=10,
            enqueue=True,
            backtrace=False,
            diagnose=False,  # diagnose=True 会把变量值（可能含用户数据）写进日志
        )
    logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        lg = logging.getLogger(name)
        lg.handlers = [_InterceptHandler()]
        lg.propagate = False
