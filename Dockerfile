# syntax=docker/dockerfile:1.7
# DeepSeek-OCR-WebUI v5 —— 多阶段构建，两个可发布目标：
#   docker build -t deepseek-ocr-webui .               # 默认：vLLM 引擎（CUDA，连续批处理，吞吐优先）
#   docker build -t deepseek-ocr-webui:hf --target hf .   # transformers 引擎（体积小、旧 GPU 也能跑）
#
# 权重不打进镜像（v4 的 13 GB 镜像拉不下来，#38）：首次启动下载到 /models（挂卷持久化），
# 离线部署设 DSOCR_MODEL_PATH 指向已下载的目录。

ARG VLLM_IMAGE=vllm/vllm-openai:v0.33.0

# ---------------------------------------------------------------- frontend
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# 同源部署：前端直接打本服务的 /ocr、/health
ENV VITE_API_BASE_URL=""
RUN npm run build

# ---------------------------------------------------------------- hf (transformers)
FROM python:3.12-slim AS hf
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    PATH=/app/.venv/bin:$PATH
WORKDIR /app
# 先只装依赖（层缓存：改源码不重装 torch）
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra hf --no-install-project
COPY server ./server
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra hf
COPY --from=frontend /src/frontend/dist /app/frontend/dist
# 容器内监听所有接口是容器网络的需要；对外暴露边界在端口发布 `-p 127.0.0.1:8001:8001`（见 docker-compose.yml）
ENV DSOCR_ENGINE=hf \
    DSOCR_FRONTEND_DIST=/app/frontend/dist \
    HF_HOME=/models \
    DSOCR_LOG_DIR=/app/logs \
    DSOCR_HOST=0.0.0.0 \
    PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 1000 app && mkdir -p /models /app/logs && chown -R app /models /app/logs
USER app
EXPOSE 8001
VOLUME ["/models"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=20m --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=8).status == 200 else 1)"
ENTRYPOINT ["deepseek-ocr-webui", "serve"]

# ---------------------------------------------------------------- vllm (default)
FROM ${VLLM_IMAGE} AS vllm
WORKDIR /app
# vLLM 镜像自带 torch / transformers / fastapi；只补本服务的核心依赖，--no-deps 装本包避免改动 vLLM 的版本钉
COPY pyproject.toml README.md ./
COPY server ./server
RUN python3 -m pip install --no-cache-dir "loguru>=0.7.3" "pymupdf>=1.26" "pydantic-settings>=2.6" "python-multipart>=0.0.20" \
 && python3 -m pip install --no-cache-dir --no-deps . \
 && python3 -m pip check
COPY --from=frontend /src/frontend/dist /app/frontend/dist
ENV DSOCR_ENGINE=vllm \
    DSOCR_FRONTEND_DIST=/app/frontend/dist \
    HF_HOME=/models \
    DSOCR_LOG_DIR=/app/logs \
    DSOCR_HOST=0.0.0.0 \
    PYTHONUNBUFFERED=1
RUN mkdir -p /models /app/logs
EXPOSE 8001
VOLUME ["/models"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=20m --retries=3 \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=8).status == 200 else 1)"
ENTRYPOINT ["deepseek-ocr-webui", "serve"]
