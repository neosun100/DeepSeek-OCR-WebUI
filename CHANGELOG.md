# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).
History for v1.0 – v4.1 lives in [archive/legacy-docs/CHANGELOG-v1-v4.md](archive/legacy-docs/CHANGELOG-v1-v4.md).

## [5.0.0] - 2026-11-07

> DeepSeek-OCR-2 on every GPU you own — vLLM or transformers on CUDA, native Apple Silicon, and CPU, with per-page quality checks you can trust.

### Added

- **New backend package** `server/deepseek_ocr_webui` (managed by `uv`, `pyproject.toml` is the single dependency source) with two engines:
  - **transformers engine** that runs on CUDA, **Apple Silicon (MPS)** and CPU. Measured with `scripts/bench.py`: M5 Max (MPS, bf16) 8.1 pages/min; T4 (fp16, eager) 7.8; A10G 9.2.
  - **vLLM engine** (continuous batching) that manages a local `vllm serve` or load-balances across several external ones (`DSOCR_VLLM_URLS`, least in-flight). Measured on an A10G: 46.4 pages/min at concurrency 1 and 132.1 at concurrency 16 (transformers: 9.5); both engines agree on the same pages with mean character recall 0.985. Ships with the workarounds vLLM 0.33 needs for OCR-2 (legacy V1 runner for the NGram logits processor, `TRITON_ALLOW_NON_CONSTEXPR_GLOBALS=1`). See [docs/BENCHMARKS.md](docs/BENCHMARKS.md).
- **Per-page output checks** in every response (`ok`, `warnings[]`, `finish_reason`): tail repetition, repetition cut, truncation, coordinate loops, invalid boxes, empty and near-empty output. Repeated tails are stopped while generating (HF `StoppingCriteria`; vLLM stream closed on detection) and trimmed from `raw_text`.
- **Readiness you can trust**: `/health` answers 503 until the model is loaded *and* a synthetic warm-up page is read back with ≥ 0.85 character recall.
- `POST /api/ocr/pdf` — page-by-page NDJSON stream with heartbeats, per-page errors, and `pages=1-3,5` ranges.
- `GET /api/capabilities` — modes, limits, engine, and known weak spots (with public benchmark evidence).
- **Swagger is the documentation**: every endpoint has a summary and description; [docs/openapi.json](docs/openapi.json) is generated and checked in CI.
- **MCP server** on mcp 2.x (`deepseek-ocr-webui-mcp`): `ocr_image`, `ocr_pdf`, `health`.
- Docker: one Dockerfile with two targets — `vllm` (default) and `hf`; weights are downloaded to a volume on first start instead of being baked in.
- GPU verification scripts (`scripts/gpu-verify/`), a throughput/quality benchmark (`scripts/bench.py`), generated README screenshots and badges.
- Frontend: model-loading / model-error health states, page-level output warnings, finish reason in the raw-result panel, engine/device/dtype in the status tooltip (en / zh-CN / zh-TW / ja-JP).

### Changed

- **find mode** is now an honest *block-level* search: DeepSeek-OCR-2 has no native "Locate" prompt (12/12 trials fell back to document parsing), so the server parses the layout and returns the blocks that contain your term. `find_term` is now required.
- **PDF pipeline in the browser**: each PDF is parsed once in a worker and its bytes are transferred once; pages are stored as JPEG at 2304 px on the long edge (aligned with the model's 3×768 tiling). A 200-page PDF used 661.9 MB of IndexedDB before and 77.7 MB now; main-thread copies went from 491.7 MB to 0.
- Upload limit for PDFs raised from 100 MB to 500 MB (one constant, enforced by a test) (#51).
- Model weights pinned to revision `aaa02f3` (#23); Linux `torch` comes from the CUDA 12.6 index (works with drivers ≥ 525 via CUDA minor-version compatibility instead of requiring ≥ 580) (#46).
- The service binds to `127.0.0.1` by default; CORS is off unless you allow-list origins; `X-Forwarded-For` is only trusted with `DSOCR_TRUST_PROXY=true`; compose publishes on `127.0.0.1` only.
- Errors share one shape: `{"detail": {"error", "message", "actual", "limit"}, "request_id"}`; the frontend shows the backend message instead of "500 Internal Server Error" (#39).
- Logging with loguru and a request id on every line and response (`X-Request-ID`).
- Development no longer sends documents to a third-party server: the dev API defaults to the same origin with a Vite proxy.

### Fixed

- Apple Silicon and CPU inference: upstream `infer()` hard-codes `.cuda()` and bf16, so v4's MPS/CPU backends could load but never infer (#30, #35, #36, #39, #40, #42, #45).
- Markdown export dropped content when a block had several boxes or in ocr-mode output (#49). Measured on the repo samples: recall 0–61 % before, 100 % after.
- Tab switching aborted the queue; it now resumes when the tab is visible again, and missing page images raise an explicit error (#47).
- Large PDFs froze the browser/Docker (#31, #50): see the PDF pipeline numbers above.
- Display text no longer contains layout labels such as `table` or `sub_title`.
- XSS: OCR output rendered as HTML is sanitized with DOMPurify (an image containing `<img onerror=…>` could run script).
- 123 of 616 frontend unit tests failed on Node 26 (native `localStorage` shadowed jsdom); production dependency audit went from 2 critical / 10 high to 0 / 0.
- MCP server sent `mode`/`search_text` while the API expected `prompt_type`/`find_term`.
- `attention_mask` warning during generation (#27).

### Removed

- 86 legacy files (four `web_service*.py`, HTML UIs, seven Dockerfiles, v1 vendored code, ~20 summary docs) moved to [`archive/`](archive/README.md); `frontend/dist` is no longer tracked.
- GitHub Pages demo deployment (the public demo backend is not hosted any more; run it yourself with Docker or `uv`).
