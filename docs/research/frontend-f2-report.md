# 前端 F2 报告：对接后端 v5 合同 + #39 / #47 / #49

分支：`worktree-agent-a916f715ada297bd5`（基于 `625b01c`），共 10 个 commit，每个 commit message 里都有六问红蓝对抗。

## 1. 验收数字（最终状态，HEAD = 4a7b07e）

| 检查 | 命令 | 结果 |
|---|---|---|
| 单测 | `NODE_OPTIONS=--no-webstorage npx vitest run` | **47 个文件 / 741 个用例全部通过**（基线 45 / 672） |
| 类型 | `npx vue-tsc -b` | exit 0 |
| Lint | `npx eslint .` | exit 0，0 problems |
| E2E | `NODE_OPTIONS=--no-webstorage npx playwright test --project=chromium --reporter=line` | **123 passed / 2 skipped / 0 failed**（基线 114 passed / 2 failed / 2 skipped；新增 7 个 v5 用例） |

跑之前确认过 5173 端口空闲：playwright 配置了 `reuseExistingServer`，如果别的 agent 的 dev server 占着 5173，e2e 测到的就是它的代码。

## 2. 各项改动与验证

### 2.1 providers.ts 错误合同（#39）— `f300e83`、`2d69c33`
- `parseErrorBody`：先认 v5 的 `detail.{error,message,actual,limit}` 和 `request_id`，再兼容 v4 的 `{detail:"..."}`、`{error:"..."}`，以及 FastAPI 默认 422 的列表格式。
- 429：先看 `detail.error` 码，没有再匹配 v4 短语，原有三种提示文案不变。
- 其他非 2xx 统一抛 `OCRApiError`（带 status、code、requestId、actual、limit、Retry-After），message 形如 `OCR API Error: 500 ...: <后端 message>`。
- 503 `model_loading` 抛 `ModelLoadingError`，可重试；503 `model_unavailable` 不重试。
- 成功响应映射 ok / finish_reason / warnings（经 normalize）/ content_chars / request_id / metadata，只在字段存在时才设，v4 响应的映射结果和以前完全一样。
- 验证：providers 测试 30 个通过。变异验证：去掉透传后端 message → **4/30 红**。

### 2.2 健康状态 — `4594ad0`
- service：503 时读 body。`status=starting` → 状态 `starting`；`status=error` → 状态 `error`，并带上 `load_error`；网络失败、超时、或非 2xx 且没有 v5 body → `unavailable`。新增 `checkNow()`，立刻查一次。
- store：新增 `serviceState`、`isReady`、`isStarting`、`isModelError`、`isUnreachable`、`loadError`、`engineInfo`、`serverVersion`。**`isHealthy` 的含义定为“能接任务”**：ready 和 starting 都是 true，error 和不可达是 false。这样 PageList、PageViewer、OCRModeSelector、OCRInputModal 里现有的预检不用改，starting 时就会放行排队，error 时就会拒绝。
- 入队等待（在 `ocr/index.ts`）：starting 时像队列满一样每 5s 等一轮；收到 503 model_loading 按 Retry-After 重试；模型加载失败时拒绝，报错里带 load_error。
- Indicator：starting 显示黄色沙漏「Model loading」；error 显示红色「Model unavailable」加 load_error；tooltip 里展示版本、engine、device · dtype。Popover 加了加载中 / 加载失败横幅和 engine 摘要行。
- 验证：新增 service 4 个、store 3 个、indicator 3 个、popover 2 个测试；e2e 覆盖 starting 和 error 两个场景。

### 2.3 页面级产物警告 — `31fa543`（i18n 在 `ccd99bd`）
- **db 不改 schema**：warnings 本来就随 OCRResult 整体存在 `pageOCRs.data` 里。新增 `db.getPageOCRSummary()`，v4 和旧记录读出来是空数组。
- PageItem：OCR 完成后的各状态下读取 summary；有失败型 warning（repetition / repetition_cut / truncated / coordinate_loop / empty_output）时显示琥珀色警告图标，tooltip 列出后端给的 message。near_empty 和 bbox_invalid 不触发图标。
- OCRRawTextPanel：新增 `warnings` 和 `finishReason` 两个 props，按语言显示结束原因，失败型 warning 排在前、提示型排在后。
- 四种语言共新增 18 个 key，四份文件 key 集合一致。
- 验证：PageItem 3 个、面板 2 个、db 1 个测试，外加 e2e。变异验证：去掉失败型过滤 → **2 红**。

### 2.4 #49 导出 md 丢内容 — `b516ccc`
- 在 `ocr-parser.ts` 新增共享的 `tokenizeRawText`：
  - 多框 `[[..],[..]]` 用并集框；
  - 坐标解析失败时保留文字，并打 `consola.warn`；
  - ocr / find 模式里 label 本身就是识别文字，予以保留（这是读 `grounding.py` 时发现的第二个丢字源）；
  - 允许 `</ref>` 和 `<det>` 之间有空白。
- markdown：没有坐标的块（自由文本、解析失败块）按阅读顺序锚定，单独成行，不再用整页框把所有块扫进一张布局表；布局行遇到下一个标题就截断，不再跨标题聚合；图片块里的文字保留。
- 判据：`markdown.recall.test.ts` 统计有效字符（`\p{L}\p{N}`，按多重集计召回），阈值 ≥95%。参照字符集独立实现，不依赖被测代码。样本是 6 个真实 `sample*.json`，加上由它们派生的多框变体和 ocr 模式变体，共 18 例。
  - 说明：真实样本里一个多框都没有，所以变体是必需的；而且只把隔一个块改成多框——如果全部改掉，旧代码会走「整段原文 fallback」，把丢字掩盖掉。
- **修复后：18/18 全部 100.0%**（例如 sample4 是 1204/1204）。
- **负对照（把 markdown.ts 和 ocr-parser.ts 还原到 HEAD 后实测）：13/20 红**
  - 多框变体：sample 0.0%，sample1 38.3%，sample2 61.0%，sample3 14.5%，sample4 55.4%，sample5 46.4%；
  - ocr 模式变体：0–0.5%；
  - 跨标题聚合用例也红。
  - 原始文档模式样本在旧代码下就是 100%，这说明 #49 的触发条件在多框和 ocr 模式输出，不在仓库自带的样本里。
- 连带：PDF 文字层现在也会包含没有标签的原文（用整页框），`pdf.test` 对应的期望已更新。

### 2.5 #47 切走后中止 — `aabe58b`
- App.vue 注册 `visibilitychange`，回到可见时调用 `ocrService.resumeOnVisible(pages)`；卸载时移除监听。
- `resumeOnVisible` 做三件事：唤醒后台挂起的任务；立刻 `checkNow()`（后台计时器被节流，健康状态可能过期）；对仍处于 pending_ocr / recognizing 但已经没有任务的页重新入队。页级的 in-flight token 保证正在跑的任务不会被重启。
- 网络错误（fetch 抛 TypeError）：标签页隐藏时不判失败，等回到可见再重提；标签页可见时最多重试 3 次，间隔 5s。
- resume 时如果页面图片缺失，显式发 `ocr:error`（提示重新导入），不再静默跳过。原来这种页会永远停在 pending。
- 验证：OCRService 新增 7 个测试，App 新增 1 个。变异验证：关掉网络错误识别 → **2 红**；去掉缺图报错 → **2 红**。
- 根因是**推断**的，没有复现：Chrome 对后台页的强节流 / 冻结，以及 Safari 断开后台连接，都会让 fetch 抛 TypeError，v4 直接把它判成页失败。

### 2.6 版本号 — `aaa08e4`
- 新增 `src/version.ts` 作为唯一来源（`v5.0 · OCR-2`）。header 徽章（原来是「OCR-2」）和 footer（原来是「v4.1 · OCR-2」）都读它。
- `version.test.ts` 扫描 src，如果非测试文件里还硬编码着 v4.x 就报红。变异验证：把 footer 还原成 v4.1 → 红。
- footer 实际在 `EmptyState.vue`，App.vue 里没有 footer。

### 2.7 E2E — `875c3b9`、`4a7b07e`
- APIMocks 默认按 v5 合同返回；`errorFormat:'v4'` 和 `legacy:true` 保留旧格式。新增 `v5-contract.spec.ts`，共 7 例，其中 **2 例是 v4 旧格式兼容**（500 的 `{error}`，429 的 `{detail:"Client at max"}`）。
- e2e 发现的回归：App.vue 的 toast 过滤规则是「message 里含 unavailable 就不弹」，透传后端 message 后会吞掉后端错误。已修：凡是 `OCR API Error:` 前缀的错误一律弹出，并加了单测。
- `ocr-mode-selector` 的「persist selected mode」用例：在下拉框里选模式本身就会触发 OCR，而这次请求原来没被 mock，发到了真实的 `DEV_API_BASE_URL`（https://ocr.cloudmantools.top）。加上网络重试后它变得不稳定，实测 1/4 红、改法不对时 3/6 红。改为先 mock、断言每次请求的 prompt_type、两次运行之间等待 completed 之后，`--repeat-each=8` **8/8 通过**。

## 3. 超出 F2 文件清单的改动（都是必要的最小改动）

| 文件 | 原因 |
|---|---|
| `components/common/EmptyState.vue` | footer 在这里（第 6 项） |
| `components/page-viewer/PageViewer.vue` | OCRRawTextPanel 挂载在这里，需要把 warnings / finish_reason 传下去，改了 2 行 |
| `App.vue` toast 过滤 | 第 1 项透传 message 引出的回归，改了 4 行 |
| `services/doc-gen/pdf.test.ts` | parseRawText 行为变化（保留原文） |
| `tests/e2e/fixtures/base-test.ts`、`tests/e2e/specs/ocr-mode-selector.spec.ts` | 新增日志的白名单，以及修上面那个不稳定用例 |
| 新增 `src/version.ts`、`src/version.test.ts` | 版本号单一来源 |

没有动 Preview.vue、vite / vitest 配置、package.json、services/pdf、workers、services/add、stores/pages.ts、services/queue。

## 4. 未解决 / 需要登记的问题

1. **其他 e2e 也可能把未 mock 的请求发到外部真实 API**（`DEV_API_BASE_URL` 是公网域名），本次没有逐个审计。e2e 会上传测试图片到第三方，建议给 e2e 统一配 `VITE_API_BASE_URL`，或在 fixture 里兜底拦截 `**/ocr`。
2. PageItem 读 warnings 是每个可见条目在状态变化时做一次 IndexedDB get。如果以后在 `stores/pages.ts` 的 ocr:success 里把 warnings 写进 DBPage，应该删掉这次读取，保持单一来源。
3. `LAYOUT_LABELS` 和 `FAILING_WARNING_CODES` 是从后端复制过来的，权威来源已在代码注释里写明。后端改了需要同步，目前没有自动校验。
4. 网络长时间断开时，可见标签页上的失败会比以前晚约 15s 才报出来（3 次重试）。
5. 被 queueManager 取消的 pending 任务不会执行 taskFn，所以 in-flight 表不会清掉。目前无害，因为被取消的页已经离开 resume 状态。根治需要改 `services/queue`，不在本次范围。
6. #47 的根因没有在真实浏览器里复现，修复针对的是推断出的机制。
7. 执行过程中有一次 `uv run python` 在主仓库根目录触发了项目重建（`Built deepseek-ocr-webui`），没有改动任何文件内容；之后都改用 `uv run --no-project`。
