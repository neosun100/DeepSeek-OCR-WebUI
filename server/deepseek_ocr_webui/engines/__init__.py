"""引擎选择。`auto`：CUDA 且装了 vLLM ⇒ vllm；否则 transformers（CUDA / MPS / CPU）。"""

from __future__ import annotations

import importlib.util
import platform
import shutil
import subprocess

from loguru import logger

from ..config import Settings
from .base import Engine, EngineOOM, EngineUnavailable, RawOutput

__all__ = ["Engine", "EngineOOM", "EngineUnavailable", "RawOutput", "create_engine", "resolve_device"]


def _nvidia_smi_summary() -> str:
    """CUDA 不可用时给出驱动信息（#46：驱动 < 580 时 CUDA 13 镜像起不来，v4 被伪装成 dtype 报错）。"""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return "未找到 nvidia-smi（容器没有 --gpus all / 未装 NVIDIA 驱动）"
    try:
        out = subprocess.run(  # noqa: S603 —— 固定参数，无外部输入
            [exe, "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10, check=False,
        )  # fmt: skip
        return (out.stdout or out.stderr).strip() or f"nvidia-smi 返回码 {out.returncode}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"nvidia-smi 调用失败：{e}"


def _no_cuda_error(torch_mod: object) -> EngineUnavailable:
    ver = getattr(torch_mod, "__version__", "未安装")
    cuda_build = getattr(getattr(torch_mod, "version", None), "cuda", None)
    return EngineUnavailable(
        f"要求使用 GPU，但 CUDA 不可用。torch={ver}（CUDA 构建 {cuda_build}）；nvidia-smi：{_nvidia_smi_summary()}。"
        " 常见原因：宿主机驱动太旧、docker 未加 --gpus all、装的是 CPU 版 torch。"
    )


def resolve_device(settings: Settings) -> str:
    """显式指定 ⇒ 不可用就失败；auto ⇒ cuda > mps > cpu；require_gpu 时绝不静默退到 CPU（#46）。"""
    try:
        import torch
    except ImportError:
        torch = None  # type: ignore[assignment]
    cuda_ok = bool(torch is not None and torch.cuda.is_available())
    mps_ok = bool(
        torch is not None
        and platform.system() == "Darwin"
        and getattr(torch.backends, "mps", None) is not None
        and torch.backends.mps.is_available()
    )
    want = settings.device
    if want == "cuda" and not cuda_ok:
        raise _no_cuda_error(torch)
    if want == "mps" and not mps_ok:
        raise EngineUnavailable("指定了 MPS，但当前环境不支持（需要 Apple Silicon + macOS 13+ 的 PyTorch）")
    if want != "auto":
        return want
    if cuda_ok:
        return "cuda"
    if mps_ok:
        return "mps"
    if settings.require_gpu:
        raise _no_cuda_error(torch)
    logger.warning(
        "未检测到 CUDA / MPS，使用 CPU 推理（单页可能需要数分钟）。nvidia-smi：{}", _nvidia_smi_summary()
    )
    return "cpu"


def create_engine(settings: Settings) -> Engine:
    name = settings.engine
    if name == "fake":
        from ..service import WARMUP_TEXT  # 延迟导入：service 依赖本包
        from .fake import FakeEngine

        return FakeEngine(warmup_text=WARMUP_TEXT)
    if name == "vllm" or (name == "auto" and settings.vllm_urls):
        return _vllm(settings)
    if name == "auto" and importlib.util.find_spec("vllm") is not None:
        try:
            import torch

            if torch.cuda.is_available():
                return _vllm(settings)
        except ImportError:
            pass
    from .hf import HFEngine

    device = resolve_device(settings)
    return HFEngine(
        model_id=settings.model_id,
        revision=settings.model_revision,
        model_path=settings.model_path,
        device=device,
        attn_implementation=settings.attn_implementation,
        repetition_check_every=settings.repetition_check_every,
    )


def _vllm(settings: Settings) -> Engine:
    from .vllm import VLLMEngine

    return VLLMEngine(
        model_id=settings.model_id,
        revision=settings.model_revision,
        model_path=settings.model_path,
        urls=settings.vllm_urls,
        port=settings.vllm_port,
        gpu_memory_utilization=settings.vllm_gpu_memory_utilization,
        max_concurrency=settings.vllm_max_concurrency,
        extra_args=settings.vllm_extra_args,
        start_timeout_s=settings.vllm_start_timeout_s,
        request_timeout_s=settings.request_timeout_s,
        log_dir=settings.log_dir,
    )
