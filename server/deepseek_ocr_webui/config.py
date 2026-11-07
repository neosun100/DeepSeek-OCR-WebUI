"""配置与阈值的唯一来源。

- `Settings`：运行期可由环境变量覆盖的部署参数（前缀 `DSOCR_`，另兼容 v4 的几个旧变量名）。
- `Limits`：所有闸门阈值。错误响应、Swagger 描述、/api/capabilities 都从这里读，不在别处写魔法数字。
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# 上游权重 revision 钉死（2026-02-03 的 main）。不钉的后果：trust_remote_code 会随上游漂移（#23 #39），
# 也是供应链风险。升级 = 改这一行 + 在 GPU 上重跑 tests/e2e。
DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-OCR-2"
DEFAULT_MODEL_REVISION = "aaa02f3811945a91062062994c5c4a3f4c0af2b0"

EngineName = Literal["auto", "hf", "vllm", "fake"]
DeviceName = Literal["auto", "cuda", "mps", "cpu"]


class Limits:
    """闸门阈值（可被同名 `DSOCR_` 环境变量覆盖的部分在 Settings 里）。

    这里的值是「拒绝请求」的边界；改动它们会改变 API 合同，因此也写进 /api/capabilities。
    """

    # 图片解码前按头部像素数拦截（解压炸弹防护）。80 MP ≈ 10000×8000，远超任何扫描件。
    MAX_IMAGE_MPIX = 80
    # PDF 每页按 DPI 估算的像素上限（不渲染只读 rect）。A0 @144 DPI ≈ 34 MP。
    MAX_PAGE_MPIX = 60
    # 上游（DeepSeek-OCR 官方 PDF 脚本）用 144 DPI 栅格化；v4 也是 144。
    PDF_DPI = 144
    # 生成上限：上游 infer() 写死 8192；更长的页 = 复读或超密表格。
    MAX_NEW_TOKENS = 8192
    # 内容字数 ≤ 此值视为「近空」：空白页的正确答案就是空，所以这是读数（warning），不是失败。
    NEAR_EMPTY_CHARS = 20


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DSOCR_", env_file=None, extra="ignore")

    # ---- 网络（默认只绑本机：对外暴露必须由部署者显式指定）----
    host: str = "127.0.0.1"
    port: int = 8001
    # 允许跨域的来源；空 = 只允许同源（前端由本服务托管时不需要 CORS）
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # 仅在确有反向代理时才信任 X-Forwarded-For；否则任何人都能伪造 IP 绕过按 IP 限流
    trust_proxy: bool = False

    # ---- 模型 / 引擎 ----
    model_id: str = DEFAULT_MODEL_ID
    model_revision: str = DEFAULT_MODEL_REVISION
    # 本地权重目录（离线部署）；设了就不联网
    model_path: str | None = None
    engine: EngineName = "auto"
    device: DeviceName = "auto"
    # 期望有 GPU 却没有时直接失败，而不是静默退到 CPU（#46：驱动太旧被伪装成 dtype 报错）
    require_gpu: bool = False
    # vLLM：外部服务地址（逗号分隔多个 = 多卡/多机，按最少在途分配）；不设则由本服务托管一个子进程
    vllm_urls: Annotated[list[str], NoDecode] = Field(default_factory=list)
    vllm_port: int = 8100
    vllm_gpu_memory_utilization: float = 0.85
    vllm_max_concurrency: int = 16
    vllm_extra_args: str = ""
    vllm_start_timeout_s: float = 1200.0
    # HF 路径的 attention 实现；None = CUDA 上尝试 flash_attention_2，失败回 eager（留痕）
    attn_implementation: str | None = None

    # ---- 并发 / 限流 ----
    max_queue: int = 32
    max_per_client: int = 1
    max_per_ip: int = 4
    request_timeout_s: float = 600.0

    # ---- 上传 ----
    max_upload_mb: int = 200
    max_pdf_pages: int = 500

    # ---- 生成 ----
    max_new_tokens: int = Limits.MAX_NEW_TOKENS
    # 复读截断：每生成这么多 token 检一次尾部（检测本身 ~ms 级）
    repetition_check_every: int = 256

    # ---- 运维 ----
    warmup: bool = True
    log_dir: str | None = None
    log_level: str = "INFO"
    frontend_dist: str | None = None

    @field_validator("cors_origins", "vllm_urls", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        # 环境变量里写逗号分隔更自然；pydantic-settings 默认要求 JSON 数组
        if isinstance(v, str):
            s = v.strip()
            if s.startswith("["):
                return json.loads(s)
            return [x.strip() for x in s.split(",") if x.strip()]
        return v

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


# v4 及更早版本的环境变量名 → v5 字段。保留它们是因为 README/compose 片段已经散在用户手里。
_LEGACY_ENV = {
    "PORT": "port",
    "LOCAL_MODEL_PATH": "model_path",
    "FORCE_BACKEND": "device",
}


def _legacy_overrides() -> dict[str, object]:
    out: dict[str, object] = {}
    for old, field in _LEGACY_ENV.items():
        val = os.environ.get(old)
        if not val or os.environ.get(f"DSOCR_{field.upper()}"):
            continue  # 新变量优先
        if field == "device":
            val = val.lower()
            if val not in ("cuda", "mps", "cpu"):
                continue
        out[field] = val
    return out


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(**_legacy_overrides())  # type: ignore[arg-type]
