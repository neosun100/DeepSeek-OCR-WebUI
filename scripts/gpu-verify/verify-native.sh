#!/usr/bin/env bash
# GPU 机器上的原生（uv，无 Docker）验证 —— 用于老 GPU（T4 / V100，sm < 80：无 bf16、无 flash-attn）的降级路径。
#
#   CODE_URL=<源码 tar.gz 的 URL> bash verify-native.sh
#
# 预言：
#   N1 uv sync --extra hf 成功；torch 看得到 CUDA
#   N2 tests/e2e/test_real_model.py 全过（真实权重：表格真值、已知文字召回 ≥0.9、切片路径）
#   N3 health.engine.dtype 与 GPU 能力一致（sm<80 ⇒ float16 且 notes 里留痕）
#   N4 原生服务 E2E（tests/e2e/test_live.py）全过；端口只监听 127.0.0.1
# 判定码：NATIVE_PASS · NATIVE_FAIL:<N…> · NATIVE_BLOCKED:<原因>
set -uo pipefail
WORK="${WORK:-/opt/dsocr}"; RES="$WORK/results"; mkdir -p "$RES"
exec > >(tee -a "$RES/verify-native.log") 2>&1
FAILS=(); note() { echo "[$(date +%H:%M:%S)] $*"; }; fail() { FAILS+=("$1"); note "❌ $1"; }

nvidia-smi --query-gpu=name,driver_version,memory.total,compute_cap --format=csv,noheader | tee "$RES/gpu.txt" \
  || { echo "VERDICT_AT_END: NATIVE_BLOCKED:no_gpu"; exit 2; }
if [ -z "${SRC:-}" ]; then
  SRC="$WORK/src"; rm -rf "$SRC"; mkdir -p "$SRC"
  curl -fsSL "${CODE_URL:?}" | tar -xz -C "$SRC" || { echo "VERDICT_AT_END: NATIVE_BLOCKED:code_download"; exit 2; }
fi
cd "$SRC" || { echo "VERDICT_AT_END: BLOCKED:cd_src"; exit 2; }
command -v uv >/dev/null || { curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null; export PATH="$HOME/.local/bin:$PATH"; }
export HF_HOME="$WORK/models"

uv sync --frozen --extra hf --group dev > "$RES/uv-sync.log" 2>&1 || { tail -20 "$RES/uv-sync.log"; echo "VERDICT_AT_END: NATIVE_BLOCKED:uv_sync"; exit 2; }
uv run python -c "import torch; print('torch', torch.__version__, 'cuda', torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_capability())" \
  | tee "$RES/torch.txt"
grep -q "True" "$RES/torch.txt" || fail "N1_cuda"

DSOCR_REAL_MODEL=1 uv run pytest -v tests/e2e/test_real_model.py -p no:cacheprovider > "$RES/real-model.log" 2>&1 || fail "N2_real_model"
tail -12 "$RES/real-model.log"

DSOCR_LOG_DIR="$RES/server-logs" uv run deepseek-ocr-webui serve --engine hf --port 8001 > "$RES/server-native.log" 2>&1 &
SPID=$!
for _ in $(seq 1 180); do code=$(curl -s -o "$RES/health-native.json" -w '%{http_code}' http://127.0.0.1:8001/health || true); [ "$code" = 200 ] && break; sleep 5; done
cat "$RES/health-native.json"; echo
uv run python - "$RES/health-native.json" <<'PY' || fail "N3_dtype"
import json, sys, torch
h = json.load(open(sys.argv[1]))
major = torch.cuda.get_device_capability()[0]
want = "bfloat16" if major >= 8 else "float16"
print("dtype", h["engine"]["dtype"], "want", want, "notes", h["engine"].get("notes"))
sys.exit(0 if h["ready"] and h["engine"]["dtype"] == want and (major >= 8 or h["engine"].get("notes")) else 1)
PY
ss -ltn | grep ':8001 ' | tee "$RES/listen-native.txt"
ss -ltn | grep ':8001 ' | grep -qv '127.0.0.1:8001' && fail "N4_bind"
DSOCR_BASE=http://127.0.0.1:8001 uv run pytest -q tests/e2e/test_live.py -p no:cacheprovider -rA > "$RES/e2e-native.log" 2>&1 || fail "N4_e2e"
tail -3 "$RES/e2e-native.log"
uv run python scripts/bench.py --base http://127.0.0.1:8001 --concurrency 1 --rounds 1 --out "$RES/bench-native.json" > "$RES/bench-native.log" 2>&1
cat "$RES/bench-native.log"
kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null

if [ ${#FAILS[@]} -eq 0 ]; then echo "VERDICT_AT_END: NATIVE_PASS"; else echo "VERDICT_AT_END: NATIVE_FAIL:$(IFS=,; echo "${FAILS[*]}")"; fi
