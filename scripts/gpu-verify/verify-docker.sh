#!/usr/bin/env bash
# GPU 机器上的 Docker 端到端验证：构建两个镜像 → 各自起服务 → E2E（产物判据）→ 基准 → 两引擎质量对照。
#
# 用法（在一台装好 NVIDIA 驱动 + Docker + nvidia-container-toolkit 的 Linux 机器上）：
#   CODE_URL=<源码 tar.gz 的 URL> bash verify-docker.sh          # 或 SRC=<已解压源码目录>
# 结果：$WORK/results/*.json + *.log；最后一行 `VERDICT_AT_END: <码>`。
#
# 跑前写死的预言（判定标准在跑之前定，不看结果再改）：
#   P1 两个镜像都能构建；记录压缩前大小
#   P2 各自 /health 在 20 分钟内 ready，预热召回 ≥ 0.85
#   P3 tests/e2e/test_live.py 全部通过（真实产物：表格真值子串、已知文字召回 ≥0.9、PDF 分页编号对齐）
#   P4 服务端口只监听 127.0.0.1（-p 127.0.0.1:8001:8001）
#   P5 基准：已知文字页召回均值 ≥ 0.9；clean 页集（样本图 + 样本 PDF 页）上复读 / 坐标循环 warning = 0
#   P6 vLLM 与 HF 在同页集上的内容一致性（双向召回最小值）均值 ≥ 0.9
# 判定码：DOCKER_PASS · DOCKER_FAIL:<Pn…> · DOCKER_BLOCKED:<原因>
set -uo pipefail
# 经 sudo -u / SSM 执行时 HOME 可能未设（set -u 下直接退出，2026-11-07 真机踩到）
: "${HOME:=$(getent passwd "$(id -un)" | cut -d: -f6)}"; export HOME

WORK="${WORK:-/opt/dsocr}"
RES="$WORK/results"
MODELS="$WORK/models"
mkdir -p "$RES" "$MODELS"
LOG="$RES/verify-docker.log"
exec > >(tee -a "$LOG") 2>&1
FAILS=()
# 只跑部分目标：TARGETS="vllm"（默认两个都跑）
read -ra TARGET_LIST <<< "${TARGETS:-hf vllm}"
# 结果回传：每个阶段后把 results/ 打包 PUT 到预签名 URL —— 实例被兜底终止也不丢结果
# （2026-11-07 教训：4 h 自毁把远端结果文件一起带走了，只剩轮询快照）
upload() {
  if [ -n "${RESULTS_PUT_URL:-}" ]; then
    # 先落文件再传：curl -T -（stdin）走 chunked 编码，S3 预签名 PUT 回 501（2026-11-07 实测）
    tar -czf /tmp/dsocr-results.tgz -C "$WORK" results && curl -fsS -X PUT -T /tmp/dsocr-results.tgz "$RESULTS_PUT_URL" >/dev/null && note "results uploaded"
  fi
  return 0
}
note() { echo "[$(date +%H:%M:%S)] $*"; }
fail() { FAILS+=("$1"); note "❌ $1 ${2:-}"; }

# ---------------------------------------------------------------- preflight
command -v nvidia-smi >/dev/null || { echo "VERDICT_AT_END: DOCKER_BLOCKED:no_nvidia_smi"; exit 2; }
nvidia-smi --query-gpu=name,driver_version,memory.total,compute_cap --format=csv,noheader | tee "$RES/gpu.txt"
docker info >/dev/null 2>&1 || { echo "VERDICT_AT_END: DOCKER_BLOCKED:no_docker"; exit 2; }
docker run --rm --gpus all ubuntu:22.04 true 2>/dev/null || note "⚠️ nvidia runtime 冒烟失败（继续，build 后再看）"
df -h / | tail -1

if [ -z "${SRC:-}" ]; then
  SRC="$WORK/src"; rm -rf "$SRC"; mkdir -p "$SRC"
  curl -fsSL "${CODE_URL:?需要 CODE_URL 或 SRC}" | tar -xz -C "$SRC" || { echo "VERDICT_AT_END: DOCKER_BLOCKED:code_download"; exit 2; }
fi
cd "$SRC" || { echo "VERDICT_AT_END: BLOCKED:cd_src"; exit 2; }
command -v uv >/dev/null || { curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null; export PATH="$HOME/.local/bin:$PATH"; }
uv sync -q --frozen --group dev || { echo "VERDICT_AT_END: DOCKER_BLOCKED:uv_sync"; exit 2; }

# ---------------------------------------------------------------- P1 build
for target in "${TARGET_LIST[@]}"; do
  note "build $target"
  t0=$(date +%s)
  if docker build --progress=plain --target "$target" -t "dsocr:$target" . > "$RES/build-$target.log" 2>&1; then
    size=$(docker image inspect "dsocr:$target" --format '{{.Size}}')
    echo "{\"target\":\"$target\",\"seconds\":$(( $(date +%s) - t0 )),\"bytes\":$size}" | tee "$RES/build-$target.json"
  else
    tail -30 "$RES/build-$target.log"; fail "P1_build_$target"
  fi
done

# 显存采样（整卡）：1 Hz 写文件，测完取峰值
vram_sampler() { while :; do nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; sleep 1; done > "$1"; }

run_engine() {
  local target="$1" name="dsocr-$1"
  docker rm -f "$name" >/dev/null 2>&1
  note "start $target"
  local t0; t0=$(date +%s)
  # 容器内日志（含 vLLM 子进程日志）挂到 results/：容器删掉后根因仍在（vLLM 根因在其日志前部，只看末尾找不到）
  mkdir -p "$RES/logs-$target"; chmod 777 "$RES/logs-$target"
  rm -f "$RES/health-$target.json"   # 旧文件会让判定读到上一轮的状态（两次踩坑）
  docker run -d --name "$name" --gpus all --shm-size 8g -p 127.0.0.1:8001:8001 -v "$MODELS:/models" \
    -v "$RES/logs-$target:/app/logs" "dsocr:$target" >/dev/null || { fail "P2_start_$target"; return; }
  vram_sampler "$RES/vram-$target.trace" & local vpid=$!
  local ready=0
  for _ in $(seq 1 240); do
    code=$(curl -s -o "$RES/health-$target.json" -w '%{http_code}' http://127.0.0.1:8001/health || true)
    [ "$code" = 200 ] && { ready=1; break; }
    if grep -q '"status": *"error"\|"status":"error"' "$RES/health-$target.json" 2>/dev/null; then break; fi
    sleep 5
  done
  echo "{\"target\":\"$target\",\"ready\":$ready,\"seconds_to_ready\":$(( $(date +%s) - t0 ))}" | tee "$RES/ready-$target.json"
  cat "$RES/health-$target.json"; echo
  if [ "$ready" != 1 ]; then docker logs --tail 80 "$name"; fail "P2_ready_$target"; kill "$vpid"; docker rm -f "$name" >/dev/null; return; fi
  uv run python -c "import json,sys; h=json.load(open('$RES/health-$target.json')); sys.exit(0 if h['warmup']['ok'] and h['warmup']['recall']>=0.85 else 1)" || fail "P2_warmup_$target"

  # P4：只监听 127.0.0.1
  ss -ltn | grep ':8001 ' | tee "$RES/listen-$target.txt"
  if ss -ltn | grep ':8001 ' | grep -qv '127.0.0.1:8001'; then fail "P4_bind_$target"; fi

  # P3：E2E（真产物）
  DSOCR_BASE=http://127.0.0.1:8001 uv run pytest -q tests/e2e/test_live.py -p no:cacheprovider -rA > "$RES/e2e-$target.log" 2>&1 \
    || { tail -40 "$RES/e2e-$target.log"; fail "P3_e2e_$target"; }
  tail -3 "$RES/e2e-$target.log"

  # P5：基准（并发档按引擎：HF 串行，并发只测排队；vLLM 测合批收益）
  local levels="1,4"; [ "$target" = vllm ] && levels="1,4,8,16"
  uv run python scripts/bench.py --base http://127.0.0.1:8001 --concurrency "$levels" --rounds 2 --out "$RES/bench-$target.json" \
    > "$RES/bench-$target.log" 2>&1 || fail "P5_bench_$target"
  cat "$RES/bench-$target.log"
  uv run python - "$RES/bench-$target.json" <<'PY' || fail "P5_quality_$target"
import json, sys
d = json.load(open(sys.argv[1]))
lv = d["levels"][0]
bad = {k: v for k, v in lv["warning_counts"].items() if k in ("repetition", "repetition_cut", "coordinate_loop")}
print("recall_mean", lv["known_text_recall_mean"], "loop_warnings", bad)
sys.exit(0 if (lv["known_text_recall_mean"] or 0) >= 0.9 and not bad else 1)
PY
  kill "$vpid" 2>/dev/null
  sort -n "$RES/vram-$target.trace" | tail -1 | xargs -I{} echo "{\"target\":\"$target\",\"vram_used_peak_mib\":{}}" | tee "$RES/vram-$target.json"
  docker logs "$name" > "$RES/server-$target.log" 2>&1
  docker rm -f "$name" >/dev/null
  upload
}

for t in "${TARGET_LIST[@]}"; do run_engine "$t"; done

# ---------------------------------------------------------------- P6 cross-engine agreement
if [ -f "$RES/bench-hf.json" ] && [ -f "$RES/bench-vllm.json" ]; then
  uv run python scripts/bench.py --compare "$RES/bench-hf.json" "$RES/bench-vllm.json" | tee "$RES/compare.json"
  uv run python -c "import json,sys; d=json.load(open('$RES/compare.json')); sys.exit(0 if (d['mean_agreement'] or 0)>=0.9 else 1)" || fail "P6_agreement"
fi

if [ ${#FAILS[@]} -eq 0 ]; then VERDICT="DOCKER_PASS"; else VERDICT="DOCKER_FAIL:$(IFS=,; echo "${FAILS[*]}")"; fi
echo "$VERDICT" > "$RES/verdict.txt"
upload
echo "VERDICT_AT_END: $VERDICT"   # 必须是最后一行：轮询读末行判定
