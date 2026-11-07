# DeepSeek-OCR-WebUI v5.0 — 翻新 Roadmap（✅ 2026-11-07 已发布 v5.0.0）

> 现行规程（替换式）。研究证据：`docs/research/issues-triage.md`（18 条 issue 定根因）、
> `docs/research/aws-gpu-ocr-lessons.md`（aws-gpu Unlimited-OCR 服务化经验）。
> 基线快照：`main@625b01c`（v4.1，2026-02-20），摸底日期 2026-11-07。

## 0. 基线（摸底实测，非推断）

| 项 | 现状 | 证据 |
|---|---|---|
| 线上 | `deepseek-ocr.aws.xin` **无 DNS 记录**；GitHub Pages 前端能打开但后端已死 | firecrawl DNS error / Pages 抓取 |
| 前端单测 | 123/616 红 —— **全部**因 Node 26 原生 `localStorage` 遮蔽 jsdom | `NODE_OPTIONS=--no-webstorage` ⇒ 672/672 绿（单变量对照） |
| 前端 E2E | chromium 115 过 / 1 偶发红（并行负载下，单跑 3/3 绿）/ 2 skip | `playwright --project=chromium` |
| 前端安全 | `npm audit` critical 1（form-data）/ high（@vue/server-renderer）/ moderate（vue-i18n XSS）；**OCR 输出 XSS**：`Preview.vue` `MarkdownIt({html:true})` + `v-html` | `Preview.vue:121,246` |
| 后端测试 | **0**（`.gitignore` 排除 `test_*.py`） | `.gitignore` |
| Mac/CPU | v4.x 推理**必然失败**：上游 `modeling_deepseekocr2.py` 写死 `.cuda()` / `autocast("cuda")` / bf16 | 上游 L495, L792-963（两份独立来源核对一致） |
| Mac 可行性 | **重定向 `.cuda()`→mps 后 M5 Max bf16 跑通**：加载 11.7 s，首推理 11.6 s（含预热），次推理 3.0 s，表格输出正确 | `/tmp/dsocr-probe` 探针 |
| CUDA 吞吐 | `max_workers=1` + `Semaphore(1)` + HF `model.infer` ⇒ 严格串行 | `web_service_unified.py:45,231` |
| 上游加速 | vLLM 已原生支持 OCR-2（官方 recipe，`NGramPerReqLogitsProcessor` 防复读）；vLLM 最新 0.33.0（2026-11-02） | recipes.vllm.ai |
| Docker | 镜像 **13 GB**（权重打进镜像）；基础镜像 CUDA 13 要求驱动 ≥580（#46/#38） | Docker Hub tags |
| 依赖 | 未钉模型 revision（#23）；`transformers==4.46.3` | `cuda_backend.py` |
| 契约断裂 | `mcp_server.py` 发 `mode/search_text`，后端收 `prompt_type/find_term` ⇒ MCP 一直坏；前端 `grounding` 后端收了不用 | `mcp_server.py:18-23` |
| 腐化 | 7 个 Dockerfile、4 个 `web_service*.py`、5 份 HTML 备份、~20 份 SUMMARY/GUIDE、`frontend/dist` 253 个构建产物入库、7.6 MB 论文 PDF、vendored v1 上游代码 | `ls` |
| 发布 | 446★ / 95 fork，**0 tag / 0 release** | GitHub |

## 1. 否决条件（什么结果会否决本期）—— 实测结论

| 否决 | 测量 | 结论 |
|---|---|---|
| Mac MPS 跑不通 OCR-2 ⇒ 砍 Mac 支持 | M5 Max 探针 + `test_real_model` 5/5 + bench | ✅ 未否决：8.1 页/分，已知文字召回 1.00 |
| 老卡（sm<80）跑不通 ⇒ 文档写「需 Ampere+」 | T4 原生 `verify-native.sh` | ✅ 未否决：NATIVE_PASS，fp16 + eager，7.8 页/分 |
| vLLM 与 HF 产物不一致（双向召回均值 < 0.9）⇒ vLLM 只作可选 | A10G `verify-docker.sh` P6 | ✅ 未否决：均值 0.985、最低 0.849（`DOCKER_PASS`）；vLLM 0.33 需 legacy V1 runner + `TRITON_ALLOW_NON_CONSTEXPR_GLOBALS=1` |
| vLLM 吞吐提升 < 2×（并发 8）⇒ 砍掉 vLLM 目标 | A10G bench | ✅ 未否决：并发 8 为 113.7 页/分 vs transformers 9.5（12×）；详见 docs/BENCHMARKS.md |
| find 模式（模型级 Locate）不可用 ⇒ 改服务端块级 | 2 图 × 3 词 × 2 写法 = 12 次 | 🔴 **否决模型级 find**（12/12 退回文档解析，上游 README 无 Locate 提示词）⇒ 改为块级搜索 |

## 2. 目标架构

```
frontend/ (Vue3, 构建产物不入库，Docker 多阶段构建)
server/ (uv 管理的 Python 包 deepseek_ocr_webui)
  config.py      Limits + Settings（全部阈值集中、env 覆盖、进 Swagger）
  errors.py      四要素错误（error/message/actual/limit）+ exception handlers
  logging.py     loguru + request_id
  documents.py   上传嗅探 · 图片解压炸弹闸 · PDF plan/rasterize 两段式（全局锁只包单页）
  grounding.py   ref/det 解析（正则提数，bbox_ok，无 eval）· 清洗
  judges.py      content_chars · repetition(J6) · coord_loop(J4) · near_empty —— 每页 warnings
  engines/
    base.py      Engine 协议：load / warmup / infer(image, prompt) -> Raw(text, finish, tokens)
    hf.py        transformers 设备无关推理（CUDA/MPS/CPU，修 .cuda()/bf16 写死）+ 复读 StoppingCriteria
    vllm.py      OpenAI 兼容客户端 → vllm serve（子进程托管或外部 URL；N 个 URL = 多卡 #32）
    fake.py      测试替身（脚本化：复读/坐标循环/空/OOM/超时）
  app.py         FastAPI：/api/ocr · /api/ocr/pdf(NDJSON 流) · /api/pdf/render · /health · /api/capabilities
                 + 兼容旧端点 /ocr /pdf-to-images /health（前端/MCP/老用户不断）
  mcp.py         修好的 MCP server
tests/ unit（FakeEngine+TestClient）· regression（钉缺陷）· e2e（真服务，不可达 skip）· mutations.tsv
docker/ Dockerfile（slim，CUDA 12.x + vLLM）· Dockerfile.mac 不做（Mac 走 uv 原生）
```

## 3. 阶段与 contract（每期必须有 contract 动作）

| 期 | expand | contract（强制） | 判据 |
|---|---|---|---|
| **M1 地基** | `server/` 包、pyproject+uv.lock、Limits/errors/logging、FakeEngine、pytest 骨架 | **删** 4 个 `web_service*.py`、`gpu_manager.py`、`backends/`、`DeepSeek-OCR-master/`、5 份 HTML、`i18n.js`、`fix_ui*.py`、6 个旧 Dockerfile；`.gitignore` 不再排除测试 | 后端单测全绿；旧入口全部删除后 `rg web_service_unified` 无引用 |
| **M2 引擎** | HF 设备无关引擎（CUDA/MPS/CPU）、vLLM 引擎、复读截断、grounding 修 | 删 `transformers==4.46.3` 之外的散落版本声明（requirements*.txt → pyproject 唯一来源） | Mac MPS 本地真推理；FakeEngine 单测覆盖复读/坐标循环/OOM；revision 钉死且 health 上报 |
| **M3 API** | 新端点 + 兼容层 + 四要素错误 + 上传闸 + PDF 流式 + Swagger + capabilities + MCP 修 | 删 `API.md` 手写副本 → 由 OpenAPI 生成 | 合同测试：每端点 summary/description；413/415/422/429/503/504 各一条；MCP 字段对齐测试 |
| **M4 前端** | XSS 净化、Node 26 修、audit 修、#49 det 解析、#47 可见性恢复、#50/#51 PDF 管线、后端错误正文透出、warnings 展示 | 删 `frontend/dist` 入库、删 `Agent.md/GEMINI.md/frontend-rate-limiting-guide.md` 重复文档 | vitest 全绿（Node 26 原生，不靠 flag）；XSS 负对照；E2E chromium 全绿 |
| **M5 交付** | slim Docker（多阶段，权重走 volume）、compose（127.0.0.1）、CI（后端+前端+E2E）、Pages | 删 7 个旧 compose/Dockerfile 变体中剩余的、`start*.sh`/`verify*.sh` 旧脚本 | CI 绿；`docker build` 在 EC2 成功 |
| **M6 GPU 验证** | EC2 GPU 实测：HF-CUDA vs vLLM 质量对照 + 吞吐 + 显存峰值 + Docker 端到端 + E2E 打真服务 | **实例回收**（terminate 本期新建的实例，核对无残留卷/SG） | 产物判据（内容字召回、无复读、bbox 合法）而非状态码；数字回填 README |
| **M7 变异 + 红蓝** | `tests/mutations.tsv` + 执行脚本 | 失活判据当场删 | 每条判据变异必红；红蓝六问写进 commit |
| **M8 发布** | README×4 翻新、CHANGELOG v5.0.0（带实测数字）、tag、Release、Milestone、Docker Hub、关闭已修 issue | **20+ 份历史 SUMMARY/GUIDE 移入 `docs/archive/`**（不在必读集） | 链接可达检查；截图为生成物 |

## 4. Issue 对应

| Issue | 期 | 修法 |
|---|---|---|
| #30 #40 #46 BF16/驱动 | M2 M5 | 设备无关引擎；CUDA 不可用时 fail fast + 报驱动；CUDA 12.x 基础镜像 |
| #35 #36 #39 #42 Mac | M2 | MPS 真推理；uv 一条命令启动；前端预构建产物随 release 提供 |
| #45 CPU | M2 | CPU 引擎真能跑（慢，文档写实测速度） |
| #31 #50 #51 大 PDF | M3 M4 | 后端逐页流式；前端 worker 缓存文档、transfer 一次、JPEG；上限进 Limits |
| #49 MD 丢内容 | M4 | 多框 det 解析 + 解析失败保留原文 + 测试 |
| #47 切后台 | M3 M4 | visibilitychange 恢复；服务端 `is_disconnected` |
| #32 多卡 | M2 | `VLLM_URLS` 多后端 / TP 文档 |
| #38 拉镜像 | M5 | slim 镜像（预计 < 8 GB，实测后写） |
| #23 #27 #44 | M2 M8 | 钉 revision；attention_mask；回复关闭 |

## 5. LLM 点清单（harness 判档 = 编排型）

**产品运行时：LLM 不做总控。** 调度、队列、限流、判据、续跑全是代码。唯一的模型调用 = OCR 推理本身
（创作点 T：图 → 文本，无唯一正确答案可机械生成）。产物质量由代码判据（J4/J6/near_empty）验收，不让模型自评。

**开发过程：** LLM 只用于 ①写代码 ②红蓝对抗审查（J：判断点）。测试、变异、基准、回收核对全部是脚本。

## 6. 不做（刻意）

- 不做调度层 / 多机路由（单机单卡是预防性的；多卡用 vLLM TP 或多 URL 已够）
- 不 vendor 上游 vLLM 自定义 wheel（官方 vLLM 已支持）
- 不把权重打进默认镜像（#38 根因）

## 7. Neo 拍板（2026-11-07）

| 事项 | 决定 | 落地 |
|---|---|---|
| 在线演示 | **不做常驻** | README 删 deepseek-ocr.aws.xin；下线 Pages 部署（无后端即空壳）；EC2 只做验证，验完回收 |
| 旧文件 | **全部移入 archive** | `git mv` 到 `archive/`（保留历史，不进构建/lint/必读集） |
| 镜像仓库 | **GHCR** | tag 触发 GitHub Actions 构建推 `ghcr.io/neosun100/deepseek-ocr-webui`（CI 内置 token，令牌不出 GitHub）；EC2 只拉取验证 |
| 推送 | **GitHub + GitLab** | 发布走 dual-push 规范 |
