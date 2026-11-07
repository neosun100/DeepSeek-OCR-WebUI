"""vLLM 引擎的命令行 / 请求体 / 启动回退（不起真 vLLM：替换子进程与就绪探测）。"""

from __future__ import annotations

import asyncio

import pytest
from PIL import Image

from deepseek_ocr_webui.engines.base import EngineUnavailable
from deepseek_ocr_webui.engines.vllm import MANAGED_MAX_MODEL_LEN, VLLMEngine


def make(urls: list[str] | None = None) -> VLLMEngine:
    return VLLMEngine(model_id="m", revision="r", model_path=None, urls=urls or [], port=8100,
                      gpu_memory_utilization=0.8, max_concurrency=4, extra_args="", start_timeout_s=1,
                      request_timeout_s=1, log_dir=None)  # fmt: skip


def test_command_toggles_processor() -> None:
    e = make()
    assert "--logits-processors" in e._command(with_processor=True)
    assert "--logits-processors" not in e._command(with_processor=False)
    cmd = e._command()
    assert cmd[cmd.index("--max-model-len") + 1] == str(MANAGED_MAX_MODEL_LEN) == "8192"


def test_body_omits_xargs_without_processor() -> None:
    e = make()
    im = Image.new("RGB", (8, 8), "white")
    e._command(with_processor=False)
    assert "vllm_xargs" not in e._body(im, "<image>\nFree OCR.", None)
    e._command(with_processor=True)
    body = e._body(im, "<image>\nFree OCR.", None)
    assert body["vllm_xargs"]["ngram_size"] == 30 and "max_tokens" not in body


def test_subprocess_env_defaults_legacy_runner(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    captured: dict = {}

    class FakePopen:
        def __init__(self, cmd, **kw):
            captured.update(kw["env"])
            self.pid = 1

        def poll(self):
            return None

    monkeypatch.delenv("VLLM_USE_V2_MODEL_RUNNER", raising=False)
    monkeypatch.setattr("deepseek_ocr_webui.engines.vllm.subprocess.Popen", FakePopen)
    e = make()
    e.log_dir = str(tmp_path)
    asyncio.run(e._start_subprocess(with_processor=True))
    assert captured["VLLM_USE_V2_MODEL_RUNNER"] == "0"
    # vLLM 0.33 + OCR-2 视觉 kernel 的 LOG2E 编译错误
    assert captured["TRITON_ALLOW_NON_CONSTEXPR_GLOBALS"] == "1"


def test_user_runner_choice_respected(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    captured: dict = {}

    class FakePopen:
        def __init__(self, cmd, **kw):
            captured.update(kw["env"])
            self.pid = 1

        def poll(self):
            return None

    monkeypatch.setenv("VLLM_USE_V2_MODEL_RUNNER", "1")
    monkeypatch.setattr("deepseek_ocr_webui.engines.vllm.subprocess.Popen", FakePopen)
    e = make()
    e.log_dir = str(tmp_path)
    asyncio.run(e._start_subprocess(with_processor=True))
    assert captured["VLLM_USE_V2_MODEL_RUNNER"] == "1"


def _patch_lifecycle(e: VLLMEngine, fail_first: str | None) -> list[bool]:
    starts: list[bool] = []
    state = {"n": 0}

    async def start(*, with_processor: bool) -> None:
        starts.append(with_processor)
        e._command(with_processor=with_processor)

    async def ready() -> None:
        state["n"] += 1
        if fail_first and state["n"] == 1:
            raise EngineUnavailable(fail_first)

    async def nothing() -> None:
        return None

    e._start_subprocess = start  # type: ignore[method-assign]
    e._wait_ready = ready  # type: ignore[method-assign]
    e._discover_model = nothing  # type: ignore[method-assign]
    e._stop_subprocess = nothing  # type: ignore[method-assign]
    return starts


def test_processor_incompatible_falls_back_with_note() -> None:
    e = make()
    starts = _patch_lifecycle(
        e, "ValueError: NGramPerReqLogitsProcessor is not a subclass of …LogitsProcessor"
    )
    asyncio.run(e.load())
    assert starts == [True, False]
    assert e.info()["ngram_processor"] is False
    assert any("NGramPerReqLogitsProcessor" in n for n in e.info()["notes"])  # 降级留痕


def test_other_startup_failures_not_swallowed() -> None:
    e = make()
    _patch_lifecycle(e, "CUDA out of memory")
    with pytest.raises(EngineUnavailable, match="out of memory"):
        asyncio.run(e.load())


def test_external_backends_skip_subprocess() -> None:
    e = make(["http://a:8000", "http://b:8000"])
    starts = _patch_lifecycle(e, None)
    asyncio.run(e.load())
    assert starts == [] and e.max_concurrency == 8
    assert e._pick_url() == "http://a:8000"


def test_log_summary_surfaces_root_cause_not_wrapper() -> None:
    from deepseek_ocr_webui.engines.vllm import summarize_vllm_log

    lines = [
        "INFO starting",
        "(EngineCore pid=147) ERROR [core.py:1584] Traceback (most recent call last):",
        '(EngineCore pid=147) ERROR [core.py:1584]   File "/x/core.py", line 1, in run',
        '(EngineCore pid=147) ERROR [core.py:1584] NameError("Cannot access global variable LOG2E from within @jit\'ed function")',
        *[f'  File "/x/wrapper{i}.py", line {i}, in f' for i in range(40)],
        "RuntimeError: Engine core initialization failed. See root cause above.",
    ]
    out = summarize_vllm_log(lines)
    assert "LOG2E" in out  # 根因在末尾 30 行之外，必须被挑出来
    assert out.index("NameError") < out.index("RuntimeError")
