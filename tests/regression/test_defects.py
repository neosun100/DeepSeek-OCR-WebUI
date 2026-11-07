"""钉住 v4 及 aws-gpu 里**已经发生过**的缺陷。每条注明来源；这些是静态扫描，跑得快、不需要模型。"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from ..conftest import ROOT

SERVER = ROOT / "server" / "deepseek_ocr_webui"
PY_FILES = sorted(SERVER.rglob("*.py"))


def _trees() -> list[tuple[Path, ast.AST]]:
    return [(p, ast.parse(p.read_text(), filename=str(p))) for p in PY_FILES]


def _calls(tree: ast.AST) -> list[ast.Call]:
    return [n for n in ast.walk(tree) if isinstance(n, ast.Call)]


def _name(func: ast.expr) -> str:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return f"{_name(func.value)}.{func.attr}"
    return ""


def test_no_eval_or_exec() -> None:
    # 上游脚本对模型生成的坐标串 eval（Unlimited-OCR #115 同源）；坐标只能正则提数
    for p, tree in _trees():
        for c in _calls(tree):
            assert _name(c.func) not in ("eval", "exec", "ast.literal_eval"), f"{p}:{c.lineno}"


def test_never_calls_upstream_infer() -> None:
    # 上游 model.infer() 写死 .cuda()/bf16 ⇒ v4 的 MPS/CPU 后端必挂（#30 #39 #40 #45）
    for p, tree in _trees():
        for c in _calls(tree):
            assert not _name(c.func).endswith("model.infer"), f"{p}:{c.lineno} 调用了上游 infer()"


def test_no_print_no_stdlib_logging() -> None:
    # 日志统一 loguru（aws-gpu API 规约）；print 会被吞或丢 request_id
    for p, tree in _trees():
        for c in _calls(tree):
            assert _name(c.func) != "print" or p.name == "__main__.py", f"{p}:{c.lineno} print"
        if p.name != "logs.py":
            for n in ast.walk(tree):
                if isinstance(n, (ast.Import, ast.ImportFrom)):
                    mods = [a.name for a in n.names] if isinstance(n, ast.Import) else [n.module or ""]
                    assert "logging" not in mods, f"{p}:{n.lineno} 用了标准库 logging"


def test_no_bare_except() -> None:
    # v4：裸 except 吞掉 HF 加载失败、坐标解析失败（违反「降级必须留痕」）
    for p, tree in _trees():
        for n in ast.walk(tree):
            if isinstance(n, ast.ExceptHandler):
                assert n.type is not None, f"{p}:{n.lineno} 裸 except"


def test_broad_except_must_log_or_reraise_or_record() -> None:
    # `except Exception` 允许，但处理体里必须有 logger / raise / 状态记录之一，不许静默
    for p, tree in _trees():
        for n in ast.walk(tree):
            if isinstance(n, ast.ExceptHandler) and isinstance(n.type, ast.Name) and n.type.id == "Exception":
                body = ast.unparse(n)
                assert re.search(r"logger\.|raise|self\.(warmup|state|load_error|_load_notes)", body), (
                    f"{p}:{n.lineno} 宽 except 没有留痕"
                )


def test_default_bind_is_localhost() -> None:
    from deepseek_ocr_webui.config import Settings

    assert Settings().host == "127.0.0.1"
    src = (SERVER / "__main__.py").read_text() + (SERVER / "app.py").read_text()
    assert '"0.0.0.0"' not in src


def test_no_wildcard_cors() -> None:
    # v4：allow_origins=["*"] + allow_credentials=True
    src = (SERVER / "app.py").read_text()
    assert 'allow_origins=["*"]' not in src
    assert "allow_credentials=True" not in src


def test_vllm_subprocess_binds_localhost() -> None:
    from deepseek_ocr_webui.engines.vllm import VLLMEngine

    e = VLLMEngine(model_id="m", revision="r", model_path=None, urls=[], port=8100, gpu_memory_utilization=0.8,
                   max_concurrency=4, extra_args="", start_timeout_s=1, request_timeout_s=1, log_dir=None)  # fmt: skip
    cmd = e._command()
    assert cmd[cmd.index("--host") + 1] == "127.0.0.1"
    assert "--revision" in cmd  # 托管 vLLM 同样钉 revision
    assert (
        "--logits-processors" in cmd
    )  # 官方 recipe 的防复读 processor 必须真的被注入（aws-gpu 踩坑 #1：静默没注入）


def test_hf_engine_restores_tensor_cuda() -> None:
    # _cuda_redirect 必须在 finally 里还原；否则同进程其它代码的 .cuda() 被永久劫持
    src = (SERVER / "engines" / "hf.py").read_text()
    body = src[src.index("def _cuda_redirect") : src.index("def _infer_sync")]
    assert "finally:" in body and "torch.Tensor.cuda = orig" in body


def test_model_revision_used_by_hf_engine() -> None:
    src = (SERVER / "engines" / "hf.py").read_text()
    assert src.count("revision=rev") >= 2  # tokenizer + model 都钉


@pytest.mark.parametrize(
    "pattern", [r"sk-[A-Za-z0-9]{20,}", r"ghp_[A-Za-z0-9]{20,}", r"ABSK[A-Za-z0-9]{10,}"]
)
def test_no_secrets_in_tracked_text(pattern: str) -> None:
    # 全局规则：发布前 grep sk- / ghp_ / ABSK。扫部署相关文件（aws-gpu 旧 unit 明文 API key 事故）
    targets = [*ROOT.glob("Dockerfile*"), *ROOT.glob("docker-compose*.yml"), *ROOT.glob("deploy/**/*"),
               *ROOT.glob(".env.example"), *PY_FILES]  # fmt: skip
    for p in targets:
        if p.is_file():
            assert not re.search(pattern, p.read_text(errors="ignore")), p


def test_no_env_secret_literals_in_deploy_files() -> None:
    targets = [
        *ROOT.glob("Dockerfile*"),
        *ROOT.glob("docker-compose*.yml"),
        *ROOT.glob("deploy/**/*.service"),
    ]
    for p in targets:
        if p.is_file():
            for line in p.read_text().splitlines():
                assert not re.search(r"(KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*\S{6,}", line, re.I), (
                    f"{p}: {line}"
                )


def test_committed_openapi_is_current() -> None:
    # API 文档是生成物：docs/openapi.json 必须与代码生成的一致（手写 API.md 在 v4 已静默过期）。
    # 更新：DSOCR_ENGINE=fake uv run deepseek-ocr-webui openapi > docs/openapi.json
    import json

    from deepseek_ocr_webui.app import create_app
    from deepseek_ocr_webui.config import Settings

    committed = json.loads((ROOT / "docs" / "openapi.json").read_text())
    current = create_app(Settings(engine="fake", log_level="WARNING")).openapi()
    assert committed == json.loads(json.dumps(current)), "docs/openapi.json 过期：按上面的命令重新生成"
