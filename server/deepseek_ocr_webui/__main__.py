"""命令行入口：`deepseek-ocr-webui [serve] [--host H] [--port P] [--engine E] [--device D]`。

默认绑 127.0.0.1。要让局域网 / 容器外访问，必须显式 `--host 0.0.0.0`（或 DSOCR_HOST），不会替你改。
"""

from __future__ import annotations

import argparse
import os
import sys

from . import __version__


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="deepseek-ocr-webui", description="DeepSeek-OCR-2 WebUI 服务")
    p.add_argument("command", nargs="?", default="serve", choices=["serve", "openapi", "version"])
    p.add_argument("--host", help="监听地址（默认 127.0.0.1）")
    p.add_argument("--port", type=int, help="端口（默认 8001）")
    p.add_argument("--engine", choices=["auto", "hf", "vllm", "fake"], help="推理引擎")
    p.add_argument("--device", choices=["auto", "cuda", "mps", "cpu"], help="transformers 引擎的设备")
    p.add_argument("--model-path", help="本地权重目录（离线部署）")
    args = p.parse_args(argv)

    if args.command == "version":
        print(__version__)
        return 0
    # CLI 参数 = 环境变量的显式覆盖（Settings 只有一个来源：环境）
    for flag, env in (("host", "DSOCR_HOST"), ("port", "DSOCR_PORT"), ("engine", "DSOCR_ENGINE"),
                      ("device", "DSOCR_DEVICE"), ("model_path", "DSOCR_MODEL_PATH")):  # fmt: skip
        val = getattr(args, flag)
        if val is not None:
            os.environ[env] = str(val)

    from .config import get_settings

    get_settings.cache_clear()
    settings = get_settings()

    if args.command == "openapi":
        import json

        from .app import create_app

        json.dump(create_app(settings).openapi(), sys.stdout, ensure_ascii=False, indent=2)
        print()
        return 0

    import uvicorn

    from .app import create_app

    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_config=None,  # 日志由 loguru 接管
        access_log=False,  # 访问日志由中间件带 request_id 记录
        timeout_graceful_shutdown=30,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
