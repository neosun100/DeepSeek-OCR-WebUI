# README 资产生成报告（v5.0）

生成日期：2026-11-07。未 commit。`docs/assets/badges/` 不是本次产物，未改动。

## 产物清单

| 文件 | 来源 | 预览 PNG（静态首帧，不进仓） |
|---|---|---|
| `docs/assets/logo.svg` | 手写 SVG（按 svg-logo-generator） | `/tmp/logo-preview.png`（512px），`/tmp/logo-32.png`（32px 小尺寸检查） |
| `docs/assets/architecture.svg` | `docs/assets/src/architecture.yaml` | `/tmp/architecture-preview.png` |
| `docs/assets/architecture-dark.svg` | 同上，`--theme dark` | `/tmp/architecture-dark-preview.png` |
| `docs/assets/ocr-flow.svg` | `docs/assets/src/ocr-flow.yaml`（kind: flowchart） | `/tmp/ocr-flow-preview.png` |
| `docs/assets/ocr-flow-dark.svg` | 同上，`--theme dark` | `/tmp/ocr-flow-dark-preview.png` |

两份 spec 放在 `docs/assets/src/`，只写关系不写坐标，文件头注释了生成命令和事实来源。

## 生成命令

```bash
cd ~/Code/arcflow     # = ~/.claude/skills/arcflow（软链）
D=~/Code/DeepSeek-OCR-WebUI/docs/assets

# 架构图
uv run --with pyyaml python -m arcflow.cli render $D/src/architecture.yaml -o $D/architecture.svg --png
uv run --with pyyaml python -m arcflow.cli render $D/src/architecture.yaml --theme dark -o $D/architecture-dark.svg --png
# 流程图
uv run --with pyyaml python -m arcflow.cli render $D/src/ocr-flow.yaml -o $D/ocr-flow.svg --png
uv run --with pyyaml python -m arcflow.cli render $D/src/ocr-flow.yaml --theme dark -o $D/ocr-flow-dark.svg --png
# （--png 产物已移到 /tmp/*-preview.png，不进仓）

# logo 预览
rsvg-convert -w 512 -h 512 $D/logo.svg -o /tmp/logo-preview.png
rsvg-convert -w 32  -h 32  $D/logo.svg -o /tmp/logo-32.png

# 动画证明（五个一起跑）
uv run --with pillow python scripts/prove_animated.py $D/logo.svg $D/architecture.svg $D/architecture-dark.svg $D/ocr-flow.svg $D/ocr-flow-dark.svg
```

## 判据输出原文

### render（最终一次）

```
✅ .../docs/assets/architecture.svg  (15 节点 / 17 边 / 10 层 / 1873×863)
   ℹ️  [crossings] 连线交叉 1 处（0.06/边）
   ℹ️  [canvas] 画布 1873×863（宽高比 2.17）
   ℹ️  [size] 20.7 KB
OK   .../docs/assets/architecture.svg: 4 dots · max off-path 0 (tol 1.5) at [1246, 356]

✅ .../docs/assets/architecture-dark.svg  (15 节点 / 17 边 / 10 层 / 1873×863)
   ℹ️  [crossings] 连线交叉 1 处（0.06/边）
   ℹ️  [canvas] 画布 1873×863（宽高比 2.17）
   ℹ️  [size] 20.5 KB
OK   .../docs/assets/architecture-dark.svg: 4 dots · max off-path 0 (tol 1.5) at [1246, 356]

✅ .../docs/assets/ocr-flow.svg  (13 节点 / 14 边 / 12 层 / 644×1732)
   ℹ️  [crossings] 连线交叉 0 处（0.00/边）
   ℹ️  [canvas] 画布 644×1732（宽高比 0.37）
   ℹ️  [size] 16.2 KB
OK   .../docs/assets/ocr-flow.svg: 4 dots · max off-path 0 (tol 1.5) at [236, 146]

✅ .../docs/assets/ocr-flow-dark.svg  (13 节点 / 14 边 / 12 层 / 644×1732)
   ℹ️  [crossings] 连线交叉 0 处（0.00/边）
   ℹ️  [canvas] 画布 644×1732（宽高比 0.37）
   ℹ️  [size] 16.0 KB
OK   .../docs/assets/ocr-flow-dark.svg: 4 dots · max off-path 0 (tol 1.5) at [236, 146]
```

单独跑 `arcflow.cli validate`：四张都只输出 `ℹ️ [size]`，exit=0，**没有 ERROR 也没有 WARN**。

### prove_animated（最终一次，exit=0）

```
logo.svg: ✅ 在动 （动 1.645% ≥ 0.1% · 阴性 0.000% · CSS×3 1.645% · SMIL×0 0.000%）
architecture.svg: ✅ 在动 （动 0.604% ≥ 0.1% · 阴性 0.000% · CSS×31 0.561% · SMIL×14 0.066%）
architecture-dark.svg: ✅ 在动 （动 0.600% ≥ 0.1% · 阴性 0.000% · CSS×31 0.561% · SMIL×14 0.059%）
ocr-flow.svg: ✅ 在动 （动 0.484% ≥ 0.1% · 阴性 0.000% · CSS×27 0.422% · SMIL×12 0.089%）
ocr-flow-dark.svg: ✅ 在动 （动 0.490% ≥ 0.1% · 阴性 0.000% · CSS×27 0.437% · SMIL×12 0.081%）
```

## 各资产说明

### logo.svg

- 设计：文档页（右上折角）+ 一道横向扫描光束 + 四角识别框，框住其中一行字。纯色底 `#18a058`，被识别的那一行和光束用 `#0d7a3e` / `#2fd07c`。
- 动画：三组 CSS 动画，都是 4s 循环、`animation-fill-mode: backwards`，关键帧只写 from 侧，终点就是基础样式。光束从上往下扫到目标行，识别框缩放后锁定，被识别的行随之加深。`@media (prefers-reduced-motion: reduce)` 下全部 `animation: none`。
- 静态渲染（rsvg）就是完整定格：光束停在被框住的那一行上。32px 下仍能认出"页面 + 框"。
- 一次修正：最初用的对角渐变底，阴性对照稳定读到 **0.001%**（三次复测都一样）。逐项排查后确认，噪声来自大面积渐变和斜边的抗锯齿；纯色版本是 0.000%。按任务要求"阴性 0%"，改成纯色底，原因写在 SVG 注释里。

### architecture.svg / architecture-dark.svg

- 内容逐项核对过仓库：2304px 见 `frontend/src/services/pdf/config.ts`；`dexie` / `p-queue` / `pdfjs-dist` 见 `frontend/package.json`；路由 `/api/ocr`、`/api/ocr/pdf`、`/ocr`（deprecated）、`/health`、`/api/capabilities` 见 `server/deepseek_ocr_webui/app.py`；`host = "127.0.0.1"` 见 `config.py`；MCP 的 `ocr_image` / `ocr_pdf` / `health` 三个工具见 `mcp_server.py`；`engines/` 下有 `vllm.py` 和 `hf.py`。
- 三个容器：浏览器 · Vue 3 WebUI、FastAPI · deepseek_ocr_webui、引擎层（二选一）。模型节点 DeepSeek-OCR-2 打了呼吸圈（`pulse`）。
- 布局调过两次。第一次 MCP 和用户在同一列，两条线共用一段竖线，看起来像一条；第二次 MCP 的说明文字贴到了 FastAPI 容器边框。最后钉在 `layer: 2`，两个问题都没了。
- 已知不足：引擎层里 vLLM 和 transformers 各有一条 reply 线到"逐页判据"，两条竖线挨得很近，transformers→模型 的线从中间穿过（全图唯一 1 处交叉）。能看懂，但不算最清爽。

### ocr-flow.svg / ocr-flow-dark.svg

- 13 个节点、两个菱形判断：「排队已满（429）？ 是 ⇒ 等待后重试 → 回到 POST」，「有失败型 warning？ 是 ⇒ 页面标警告（结果照常返回）→ 前端预览；否 ⇒ 直接到前端预览」。"引擎推理"节点打了呼吸圈，说明文字是"流式复读检测 · 命中即截断"。
- 0 处交叉，没有文字重叠或溢出（浅色、深色预览都看过）。
- 已知不足：画布很高（644×1732，宽高比 0.37）。改成 LR 方向，12 层会超过 3.2 的宽高比上限，所以保持 TB。

## 预览检查结论

五张 PNG 都看过：文字没有重叠，没有越出画布或容器，深色版本的容器框和文字都看得清。

## English diagrams

Generated 2026-11-07. Not committed.

| File | Source | Preview PNG (static first frame, not in repo) |
|---|---|---|
| `docs/assets/architecture-en.svg` | `docs/assets/src/architecture-en.yaml` | `/tmp/architecture-en-preview.png` |
| `docs/assets/architecture-en-dark.svg` | same spec, `--theme dark` | `/tmp/architecture-en-dark-preview.png` |
| `docs/assets/ocr-flow-en.svg` | `docs/assets/src/ocr-flow-en.yaml` | `/tmp/ocr-flow-en-preview.png` |
| `docs/assets/ocr-flow-en-dark.svg` | same spec, `--theme dark` | `/tmp/ocr-flow-en-dark-preview.png` |

The `*-en.yaml` specs are copied from the Chinese specs. Node ids, groups, `layer`, `pulse`, `icon`, `shape`, and every edge (`from` / `to` / `flow` / `static`) are unchanged. Only title, subtitle, footer, group labels, node labels, node `sub`, and edge labels were translated. Technical names were kept as-is.

### Commands

Same commands as the Chinese diagrams, with `-en` in the file names:

```bash
cd ~/Code/arcflow
D=~/Code/DeepSeek-OCR-WebUI/docs/assets
for n in architecture ocr-flow; do
  uv run --with pyyaml python -m arcflow.cli render $D/src/$n-en.yaml -o $D/$n-en.svg --png
  uv run --with pyyaml python -m arcflow.cli render $D/src/$n-en.yaml --theme dark -o $D/$n-en-dark.svg --png
done
# --png output was moved to /tmp/*-en-preview.png; it is not in the repo
for f in architecture-en architecture-en-dark ocr-flow-en ocr-flow-en-dark; do
  uv run --with pyyaml python -m arcflow.cli validate $D/$f.svg
done
uv run --with pillow python scripts/prove_animated.py $D/architecture-en.svg $D/architecture-en-dark.svg $D/ocr-flow-en.svg $D/ocr-flow-en-dark.svg
```

### Check output (final run, verbatim)

#### render

```
✅ .../docs/assets/architecture-en.svg  (15 节点 / 17 边 / 10 层 / 1877×863)
   ℹ️  [crossings] 连线交叉 1 处（0.06/边）
   ℹ️  [canvas] 画布 1877×863（宽高比 2.17）
   ℹ️  [size] 20.7 KB
OK   .../docs/assets/architecture-en.svg: 4 dots · max off-path 0 (tol 1.5) at [1246, 356]
✅ .../docs/assets/architecture-en.png（⚠️ PNG 是**静态首帧** —— 动画只在 SVG 里）
exit=0
✅ .../docs/assets/architecture-en-dark.svg  (15 节点 / 17 边 / 10 层 / 1877×863)
   ℹ️  [crossings] 连线交叉 1 处（0.06/边）
   ℹ️  [canvas] 画布 1877×863（宽高比 2.17）
   ℹ️  [size] 20.6 KB
OK   .../docs/assets/architecture-en-dark.svg: 4 dots · max off-path 0 (tol 1.5) at [1246, 356]
✅ .../docs/assets/architecture-en-dark.png（⚠️ PNG 是**静态首帧** —— 动画只在 SVG 里）
exit=0
✅ .../docs/assets/ocr-flow-en.svg  (13 节点 / 14 边 / 12 层 / 645×1732)
   ℹ️  [crossings] 连线交叉 0 处（0.00/边）
   ℹ️  [canvas] 画布 645×1732（宽高比 0.37）
   ℹ️  [size] 16.3 KB
OK   .../docs/assets/ocr-flow-en.svg: 4 dots · max off-path 0 (tol 1.5) at [245, 146]
✅ .../docs/assets/ocr-flow-en.png（⚠️ PNG 是**静态首帧** —— 动画只在 SVG 里）
exit=0
✅ .../docs/assets/ocr-flow-en-dark.svg  (13 节点 / 14 边 / 12 层 / 645×1732)
   ℹ️  [crossings] 连线交叉 0 处（0.00/边）
   ℹ️  [canvas] 画布 645×1732（宽高比 0.37）
   ℹ️  [size] 16.1 KB
OK   .../docs/assets/ocr-flow-en-dark.svg: 4 dots · max off-path 0 (tol 1.5) at [245, 146]
✅ .../docs/assets/ocr-flow-en-dark.png（⚠️ PNG 是**静态首帧** —— 动画只在 SVG 里）
exit=0
```

#### validate

```
== architecture-en
   ℹ️  [size] 20.7 KB
exit=0
== architecture-en-dark
   ℹ️  [size] 20.6 KB
exit=0
== ocr-flow-en
   ℹ️  [size] 16.3 KB
exit=0
== ocr-flow-en-dark
   ℹ️  [size] 16.1 KB
exit=0
```

All four exit with code 0, with no ERROR and no WARN.

#### prove_animated (exit=0)

```
architecture-en.svg: ✅ 在动 （动 0.593% ≥ 0.1% · 阴性 0.000% · CSS×31 0.549% · SMIL×14 0.065%）
architecture-en-dark.svg: ✅ 在动 （动 0.589% ≥ 0.1% · 阴性 0.000% · CSS×31 0.550% · SMIL×14 0.058%）
ocr-flow-en.svg: ✅ 在动 （动 0.549% ≥ 0.1% · 阴性 0.000% · CSS×27 0.491% · SMIL×12 0.094%）
ocr-flow-en-dark.svg: ✅ 在动 （动 0.534% ≥ 0.1% · 阴性 0.000% · CSS×27 0.482% · SMIL×12 0.084%）
```

### Wording changes made to pass the checks and the visual review

- **Negative control was not 0.** The first wording of the flowchart diamond was `Failing warning?`. With it, the negative control for the dark theme read **0.001%**, the same on three runs. I located the differing pixels at about (235–246, 1201–1204), which is the bottom tip of the diamond. The diamond center x had a fractional value (226.405). The Chinese diamond center was a whole number (236.0), and its negative control was 0. I then rendered the label wordings below and measured both themes:

  | Label | Light negative | Dark negative |
  |---|---|---|
  | `Any failed warning?` | 0.001% | 0.002% |
  | `Has a failing warning?` | 0.000% | 0.002% |
  | `Failing warning found?` | 0.000% | 0.002% |
  | `Any failing warning?` | 0.001% | 0.000% |
  | `Any failure warning?` | 0.000% | 0.000% |

  I used `Any failure warning?`, the only wording that read 0 in both themes. I changed the subtitle to "failure warning" to match.
- **Line pressing on a sub-label (visual review).** In the architecture diagram, the vertical reply lines into "Per-page judges" pressed on the first letter of its sub-label. The ends of the transformers sub-label also touched lines. The `edge-through-label` check did not report this, so I only saw it in the preview. I shortened the wording:
  - `repeat / bbox loop / truncation / empty` → `repeat / loop / cutoff / empty`
  - `CUDA / MPS / CPU · repeat StoppingCriteria` → `CUDA/MPS/CPU · repeat StoppingCriteria`
  - `OpenAI-compatible stream · NGram anti-repeat · least in-flight URL` → `OpenAI stream · NGram anti-repeat · least-busy URL`
- **YAML parsing.** A `?` inside a YAML flow mapping breaks parsing, so the two diamond labels are written in quotes.

### Preview check

I looked at all four final PNGs. English labels do not overlap each other and do not go outside their nodes, group frames, or the canvas. Group frames and text are visible in the dark versions. In the flowchart, the "Export MD / DOCX / PDF" label wraps onto two lines inside its node; it is not cut off and the check reports no truncation.

### Known limitation: the legend is still in Chinese

The legend at the bottom left reads `图例 · 请求 request → · 写入 write …`. This text is hard-coded in arcflow (`arcflow/palette.py` `FLOW[*][2]` and the `图例` string in `arcflow/render.py`). The spec's `legend` key only chooses which flows appear, not their text. Every entry already includes the English flow name. Translating the legend fully needs a language option added to arcflow. That is a change to the skill itself and goes through its own ROADMAP / touchstone process, so I did not change it in this task.
