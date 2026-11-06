# F3 报告：前端 PDF 管线（#50 / #51 / #31）

- 分支：`worktree-agent-a7395551a1adf1028`
- 范围：`frontend/src/services/pdf/**`、`frontend/src/workers/**`、`frontend/src/services/add/**`、PDF 相关 E2E spec
- 日期：2026-11-07

## 1. 根因：分诊推断全部被证实，另外多挖出 2 条

分诊（`issues-triage.md`）列了 4 条推断。我用两套可重复的测量去验证（见 §3），结论如下：

| # | 分诊推断 | 结论 | 证据（修前实测） |
|---|---|---|---|
| 1 | File 先转 base64 再转 ArrayBuffer，要复制 3 份 | ✅ 证实，而且更糟：`loadPDF` 被调了**两次**（`add/index.ts` 先调 `getPDFMetadata`，`processPDF` 又调一次），所以 base64 往返也走了两遍 | sample3：`readAsDataURL` 17.1 MB（2 次），`atob` 34.3 M 字符（3 次） |
| 2 | 每页 `slice(0)` 复制整本 PDF，再用 postMessage 结构化克隆进 worker | ✅ 证实 | 200 页：主线程 `slice` 201 次，共 491.7 MB；克隆进 worker 489.3 MB，transfer 为 0 |
| 3 | worker 每页重新 `getDocument` 解析整本 | ✅ 证实，主线程还另外解析了 3 次（loadPDF×2，字体分析×1） | harness 计数：sample3 一共调了 35 次 `getDocument`，200 页一共 203 次 |
| 4 | scale 2.5 的 PNG 全部写进 IndexedDB | ✅ 证实 | 200 页：661.9 MB PNG，平均每页 3.31 MB |
| 新 5 | **`concurrency: 1` 实际没生效**：队列任务 `postMessage` 之后立刻 return，不等 worker 回复，于是 N 页一次性全部投进 worker，在 worker 里交错并发渲染。N 个 canvas 加 N 份 PDF 副本会同时存活 | ✅ 从代码确认（`pdfQueue.ts` 旧版 `renderPDFPage`），修后有测试钉住 | 修前 200 页的 200 条 render 消息在入队阶段就全部发出 |
| 新 6 | 主线程 `config.ts` 只为了读一个版本号就 import 了 pdfjs-dist，另外 `pdf/index.ts` 把 legacy `pdf.worker`（2.13 MB）也打包进了产物 | ✅ | dist 总量 13,175,995 B |

关于 #50 要说清楚：它的报错原文只在截图里，我们读不到。所以这里说"修复 #50"，意思是"去掉了已测到的、随页数线性增长的内存/存储开销，并且 200 页实测能跑通"，**不是**"复现了用户截图里那条报错"。

## 2. 改动（3 个代码 commit）

| commit | 内容 |
|---|---|
| `f761abf` test(e2e) | 新增 `tests/e2e/specs/pdf-pipeline-metrics.spec.ts`：真实 Chromium 中的测量 spec，默认跳过，设 `PDF_METRICS=1` 才运行。它只 hook 浏览器 API，不依赖 worker 协议，所以修前修后用的是同一把尺子 |
| `a23c9bf` perf(pdf) | 核心改动：①worker 协议改成 `open / render / close`。`open` 把字节放进 transfer list 送过去（零拷贝），worker 按 docId 缓存 `PDFDocumentProxy`，回复 `numPages` 和前 3 页文字样本（回填字体还是在主线程选，因为检测要用 `document`）。`close` 时 destroy；同一个 id 重新 open 时会先 destroy 旧文档。②队列的 render 消息只带 docId；每个任务都 await worker 的回复，这样才有真背压，同一时刻只有一页在渲染；单页超时 120 s 标为 error；worker 崩溃时立即让在途的页失败；最后一页完成后发 close；`clearQueue`（取消）会关闭所有文档，并 reject 还在途的 open。③`PDFService.processPDF`：先校验，再把 File（Blob）存入 DB 供断点续传，然后 `file.arrayBuffer()` 读一次，交给队列，返回页数（add 服务不再单独解析一遍）。失败时删掉孤儿源文件。删掉了只有测试在用的主线程解析 API（loadPDF / getPDFMetadata / generateThumbnail / getCachedPDF 等），也删掉了主线程所有 pdfjs import。④页图改为 JPEG q0.92，scale = 2304 / 长边，最多 4 倍；页文件名改成 `*_N.jpg` |
| `722c605` feat(add) | 上限集中到 `src/services/add/limits.ts` 的 `FILE_LIMITS`（PDF 500 MB，图片 10 MB），只此一处定义；`limits.test.ts` 扫描 `src/`，保证别处不再出现 `N*1024*1024` 字面量 |

### 取值依据：2304 px 长边、JPEG 0.92

- 依据 DeepSeek-OCR-2 的 `modeling_deepseekocr2.py`（本机 HF 缓存 `aaa02f38…`）：
  - 图片边长 ≤ 768 时不切片。
  - 否则走 `dynamic_preprocess(min_num=2, max_num=6, image_size=768)`，另加一张 pad 到 1024 的全局视图。
  - A4 / Letter 竖版的宽高比约 0.707，最接近的网格是 2×3（比例 0.667），所以模型总会把页面缩放到 **1536×2304**。横版同理是 3×2。
- 因此长边渲染到 2304 = 3×768 不会损失模型能用到的像素；渲染得更大的部分模型会丢掉，更小则会被放大。
- 旧的固定 scale 2.5：A4 只有 1488×2105（模型还得放大 1.09 倍）。而 A3、海报、MediaBox 很大的扫描件会出巨型 canvas，例如 A0 是 8427×5960。新算法让所有页的长边都落在 2304。
- 和任务书建议的"约 2000"相比：2304 刚好对齐模型的切片网格。改成 2000 的话，A4 会被模型放大 1.15 倍，所以没采用。
- 不用 WebP 的原因：
  - Safari 的 `convertToBlob` 不能编码 WebP，会静默退回 PNG；
  - 文字+图片 PDF 导出（`doc-gen/pdf.ts` 的 `embedImage`）只支持 JPG 和 PNG。
- 两个参数都在 `PAGE_RENDER_CONFIG`（`src/services/pdf/config.ts`）里，可以调。

### i18n

超限提示原本就**没有 i18n key**：错误是 service 层的英文字符串，经 `result.error` 显示。措辞我保留了（"is too large" / "Maximum size is …MB"），另外补上了实际大小。没有动 locale 文件。如果以后要国际化，需要新增一个 key，例如 `errors.fileTooLarge`，参数为 `{ name, actual, max }`。

## 3. 测量方法（可重复）

| 工具 | 命令 | 测什么 |
|---|---|---|
| 浏览器 spec | `PDF_METRICS=1 [PDF_METRICS_HUGE=1] NODE_OPTIONS=--no-webstorage npx playwright test pdf-pipeline-metrics --project=chromium --reporter=line` | 主线程大块拷贝（slice、Blob.arrayBuffer、readAsDataURL、atob）；发往 render worker 的 PDF 字节，分开计"克隆"和"transfer"；主线程 pdf.js 文档数；IndexedDB 中页图的张数、字节数、MIME 和像素尺寸；全部页就绪所需时间。结果写到 `test-results/pdf-metrics/*.json` |
| 单元 harness | `NODE_OPTIONS=--no-webstorage npx vitest run src/services/pdf/pdfPipeline.metrics.test.ts` | 真实链路 add → pdf → queue → **真实 worker 模块**，中间接一个按结构化克隆语义（遵守 transfer list）投递消息的假 Worker；对 `getDocument` 和 destroy 计数。修前在旧代码上直接跑这个文件得到了基线；修后它就是回归门禁 |

为什么 worker 内的 `getDocument` 次数要靠 harness：pdf.js 在 worker 里解析时没有起一个 Playwright 看得见的嵌套 Worker。我试过 hook，读数一直是 0，所以不拿浏览器读数来报，改由 harness 精确计数。

## 4. 前后对比

### sample3.pdf（8,563,980 B，32 页）

| 指标 | 修前 | 修后 |
|---|---|---|
| 主线程 `slice` 拷贝 | 33 次 / 282.6 MB | **0** |
| base64：readAsDataURL / atob | 17.1 MB / 34.3 M 字符 | **0 / 0** |
| `file.arrayBuffer()` 读取 | 0 | 1 次 / 8.56 MB（唯一一份拷贝） |
| 带 PDF 字节的 worker 消息 | 32 条 | **1 条**（open） |
| PDF 字节克隆进 worker | 274.0 MB | **0** |
| PDF 字节 transfer | 0 | 8.56 MB |
| `getDocument` 总次数（harness） | 35（主线程 3 + worker 32） | **1** |
| 主线程 pdf.js 文档（浏览器） | 3 | **0** |
| 页图格式 / 首页像素 | PNG / 1488×2105 | JPEG / 1628×2304 |
| 页图总量 / 每页均值 | 43.0 MB / 1.34 MB | **18.6 MB / 0.58 MB** |
| 全部页就绪 | 3.1 s | 2.0–2.6 s |

### 生成的 200 页 PDF（2,446,376 B，每页嵌同一张 2.4 MB 照片）

| 指标 | 修前 | 修后 |
|---|---|---|
| 主线程 `slice` 拷贝 | 201 次 / 491.7 MB | **0** |
| base64：readAsDataURL / atob | 4.9 MB / 9.8 M 字符 | **0** |
| PDF 字节克隆进 worker | 489.3 MB（200 条消息） | **0**（只有 1 条 transfer 2.45 MB） |
| `getDocument` 总次数（harness） | 203 | **1** |
| **IndexedDB 页图总占用** | **661.9 MB**（3.31 MB/页） | **77.7 MB**（0.39 MB/页），**降为原来的 1/8.5** |
| 全部页就绪 | 52.2 s | 31.7–34.0 s |

### 超过旧上限的 PDF（#51 验证，修后）

- 输入：198,366,753 B，60 页，每页独立嵌入一张 3.3 MB 照片。
- 结果：60 页全部就绪，error 0 页，耗时 12.6 s。
- 拷贝情况：PDF 字节只 transfer 了 1 次，克隆为 0。页图总量 39.7 MB。
- 修前这个文件会直接被 100 MB 上限拦下。

### 产物体积

`vite build` 的 dist 总量从 13,175,995 B 降到 10,638,977 B（−2.54 MB）：
- legacy `pdf.worker.mjs`（2.13 MB）不再打包；
- 主线程不再加载 pdf.js 的 417 KB chunk。现在 pdf.js 只存在于 `pdfRender.worker` 里。

## 5. 测试与验收

| 项 | 修前 | 修后 |
|---|---|---|
| `NODE_OPTIONS=--no-webstorage npx vitest run` | 45 个文件，672 通过 | **47 个文件，690 通过，0 失败** |
| `npx vue-tsc -b` | — | **exit 0** |
| `npx eslint .` | — | **exit 0，0 problem** |
| PDF / 文件添加相关 E2E（file-adding、order-integrity、persistence、batch-export、batch-ocr、architecture-verification、page-reordering、edge-cases、error-handling、concurrent-operations） | — | **36 通过，2 跳过**（跳过的是原有的 webkit 和 skip 标记） |
| 全量 chromium E2E | — | **116 通过，5 跳过，0 失败**（跳过：3 个 metrics spec 未设开关，2 个原有） |

E2E 的执行方式要说明一下：我**没有**直接用默认配置跑，而是用了一个本地临时配置。它 import 原 `playwright.config.ts`，只把端口改成 5273，并设 `reuseExistingServer: false`。原因是默认配置在 5173 上 `reuseExistingServer: true`，而另外两个 agent 的 worktree 也可能在 5173 起 dev server，那样会测到别人的代码。这个临时文件没有提交，已经删除，命令其余部分与要求一致。

新增或改写的单测覆盖了任务书要求的各点：

- **缓存命中**：5 页只调 1 次 `getDocument`，页与页之间不 destroy（`pdfRender.worker.test.ts`）。
- **取消时 destroy**：`clearQueue` 会向每个打开的 docId 发 close，在途的渲染被释放，在途的 open 被 reject。worker 侧 close 会调 `destroy`，同 id 重新 open 时也会 destroy 旧文档。
- **transfer 后不再复制**：用 spy 验证 `ArrayBuffer.prototype.slice` 一次都没被调用；open 消息的 transfer list 等于 `[pdfData]`；发送后 `pdfData.byteLength === 0`（已 detach）；render 消息里没有 `pdfData`。
- **上限唯一**：`limits.test.ts` 扫描 `src/`，外加扫描器自检，并且确认 `BYTES_PER_MB = 1024 * 1024` 这个定义本身不算违规。
- 另外覆盖了：背压（未收到回复前任务保持 pending）、120 s 超时、worker 崩溃、open 失败、0 页、断点续传时重新 open（transfer）、续传时打不开、JPEG 命名、scale 计算（A4 / A0 / 小页 / 非法尺寸）、主线程模块不得 import pdfjs-dist。

**判据确实有效（变异测试）**：每个变异都实际落地、测试变红，然后恢复。

| 变异 | 结果 |
|---|---|
| 去掉 open 的 transfer list | 4 红 |
| worker 每页用完就丢掉缓存 | 缓存命中测试红 |
| `clearQueue` 不发 close | 取消测试红 |
| 不 await worker 回复 | 3 红 |
| 在 `pdf/index.ts` 加回 `100 * 1024 * 1024` | 上限唯一测试红，并列出违规位置 |

## 6. 未解决 / 登记项

1. **超出范围（db）**：`db.getPageImage` 和 `getPageExtractedImage` 遇到 ArrayBuffer 记录（WebKit 路径）时一律包成 `image/png`，现在 JPEG 字节会被贴上 PNG 的 MIME。浏览器 `<img>`、pdf-lib 的 `embedJpg`（会先尝试）、OCR 上传（文件名本来就叫 `image.jpg`）都会按内容嗅探，所以暂时没坏，但标签不对。建议 db 的负责人按 magic bytes 判断类型。
2. **超出范围（db）**：WebKit 上 `db.saveFile` 会把 File 转成 ArrayBuffer 再存，500 MB 文件时主线程会多出一份 500 MB 拷贝。Chromium 和 Firefox 不受影响。
3. **500 MB 本身没实测**：只实测到 198 MB。修后主线程峰值大约是 1 份文件大小（`arrayBuffer()` 读出、transfer 之前的那一刻），worker 中再由 pdf.js 持有一份。
4. **没有测 JS 堆峰值**：拷贝次数和字节数是精确的，但 `performance.memory` 的峰值没有采样。若要给 #50 补一个"峰值内存"数字，可以在 metrics spec 里加上采样。
5. **行为变化需要告知**：
   - 新页文件名是 `*_N.jpg`。旧库里的 `*_N.png` 页仍能续传，正则两种都认。
   - A4 页的像素增加约 20%（1488×2105 → 1628×2304），但字节数下降了。
   - 一页卡死最多会阻塞队列 120 s（以前不会被发现，会一直挂着）。
   - `PDFService` 删掉了 loadPDF / getPDFMetadata / generateThumbnail / getCachedPDF / clearCache / getPageCount / getPageInfo。除了测试，没有调用方。`PDFPageInfo` 和 `PDFProcessingOptions` 两个类型还在，因为 `services/index.ts`（不在我的范围内）还在导出它们。
6. **i18n**：如果要把超限提示国际化，需要新增 `errors.fileTooLarge`（参数 `{ name, actual, max }`），本次没有改 locale。
7. **后端**：#31 的后端部分（旧版同步渲染、全页 base64 一次返回）不在 F3 范围内。

## 7. 净增减

| 范围 | 增 / 减 |
|---|---|
| 生产代码，commit a23c9bf | +456 / −574（净 −118 行） |
| 生产代码，commit 722c605 | +29 / −11 |
| 生产代码合计 | 净 −100 行 |
| 测试 | +887 / −809，+85 / −9 |
| E2E spec | +1 个文件，含 huge 用例共 260 行 |
| 产物 | −2.54 MB |
