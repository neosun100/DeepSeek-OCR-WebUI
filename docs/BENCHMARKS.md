# Benchmarks & verification record (v5.0.0)

All numbers come from [`scripts/bench.py`](../scripts/bench.py) and [`scripts/gpu-verify/`](../scripts/gpu-verify) runs on
2026-11-07. Machines were dedicated (no other GPU work). Re-run them yourself — the commands are at the end.

**Page set** (12 pages): 5 sample images, 3 rendered PDF pages, 4 synthetic pages with known text (EN / ZH / JA).
Mode `document`; each concurrency level runs the set twice after a warm-up pass. "Recall" = character recall on the
synthetic pages (ground truth known).

## Throughput

| Hardware | Engine | Concurrency | Pages / min | p50 | p95 | Recall | Errors |
|---|---|---|---|---|---|---|---|
| NVIDIA A10G 24 GB (g5.2xlarge) | **vLLM 0.33** (bf16, NGram processor) | 1 | 46.4 | 0.81 s | 2.75 s | 1.00 | 0 |
| | | 4 | 101.0 | 2.19 s | 4.53 s | 1.00 | 0 |
| | | 8 | 113.7 | 3.65 s | 6.06 s | 1.00 | 0 |
| | | 16 | **132.1** | 5.88 s | 9.37 s | 1.00 | 0 |
| NVIDIA A10G 24 GB | transformers (bf16, eager) | 1 | 9.5 | 2.05 s | 16.3 s | 1.00 | 0 |
| | | 4 | 9.5 | 26.7 s | 38.9 s | 1.00 | 0 |
| NVIDIA T4 16 GB (g4dn.xlarge) | transformers (fp16, eager) | 1 | 7.8 | 2.6 s | 19.1 s | 1.00 | 0 |
| Apple M5 Max 128 GB | transformers (MPS, bf16) | 1 | 8.1 | 3.3 s | 20.5 s | 1.00 | 0 |

- transformers processes one page at a time, so concurrency only adds queueing (p50 grows, throughput does not).
- vLLM at concurrency 8 / 16 was measured with `DSOCR_MAX_PER_IP=64`: the default per-IP limit (4) answered the extra
  requests with **429 `ip_limit`** — admission control working as designed (confirmed from the responses).

## Engine agreement (vLLM vs transformers, same page set)

Bidirectional character recall between the two engines' outputs: **mean 0.985, min 0.849** (`sample2.png`, a dense
mixed page; 478 vs 468 letters/digits). All other pages: 1.000.

## Memory

| Engine | Measure | Value |
|---|---|---|
| transformers on A10G | `torch.cuda.max_memory_allocated()` per request | 7785 MiB |
| transformers on A10G | whole-card `nvidia-smi` peak | 9423 MiB |
| vLLM on A10G | whole-card `nvidia-smi` peak (`gpu_memory_utilization=0.85` pre-allocates the KV cache) | 19889 MiB |

## Startup

| | Value |
|---|---|
| Docker image size (unpacked) | `hf` 4.05 GB · `vllm` 9.84 GB (weights not included) |
| `/health` ready, weights already in the volume | transformers 16–84 s · vLLM 106 s (final verification run) |
| Warm-up page recall at startup | 1.00 on every machine |

## Output-check calibration

The repetition / coordinate-loop judges ([`judges.py`](../server/deepseek_ocr_webui/judges.py)) were ported from a
sibling project and calibrated there on 272 raw outputs. On DeepSeek-OCR-2:

- **No false positives** on real clean pages: 0 `repetition` / `repetition_cut` / `coordinate_loop` warnings across all
  runs above (4 environments × 12 pages × ≥ 2 rounds; final Docker verification: `DOCKER_PASS`, both images e2e 10/10). Only `near_empty` (blank-ish sample images) was reported.
- Two false-positive shapes found during development and fixed before release (unit tests pin both): numeric tables
  whose rows normalise to the same template, and the zlib-ratio detector on the same tables.
- **Not yet observed:** a real repetition loop from DeepSeek-OCR-2 in these runs, so detection of *real* loops is only
  verified on synthetic loops (verbatim, incrementing template, perturbed). Please report pages that loop.

## Platform findings that shaped v5 (each reproduced, then fixed)

| Finding | Where | Fix |
|---|---|---|
| Upstream `infer()` hard-codes `.cuda()` / bf16 | M5 MPS, T4 | device-agnostic preprocessing + scoped redirect |
| PyPI torch is a CUDA 13 build (driver ≥ 580) | T4 | Linux torch from the cu126 index |
| `python:3.12-slim` has no C compiler for Triton JIT | A10G `hf` image | `gcc` in the image; the warm-up caught it at startup |
| vLLM `max_model_len` above the model's 8192 positions | A10G | 8192, `max_tokens` derived from remaining context |
| vLLM 0.33 V2 runner rejects the V1 NGram logits processor | A10G | legacy V1 runner by default, logged fallback without the processor |
| vLLM 0.33's Triton: `NameError: LOG2E` compiling the OCR-2 vision attention kernel | A10G | `TRITON_ALLOW_NON_CONSTEXPR_GLOBALS=1` |
| No native "Locate" prompt in OCR-2 (12/12 trials) | M5 MPS | `find` = block-level search on the server |

## Reproduce

```bash
# against any running server
uv run python scripts/bench.py --base http://127.0.0.1:8001 --concurrency 1,4,8,16 --out bench.json
uv run python scripts/bench.py --compare bench-hf.json bench-vllm.json

# full Docker verification on a Linux + NVIDIA machine (both images, e2e, bench, agreement)
CODE_URL=<tar.gz of the repo> bash scripts/gpu-verify/verify-docker.sh
# older GPUs without Docker
CODE_URL=<tar.gz of the repo> bash scripts/gpu-verify/verify-native.sh
```
