# aws-gpu OCR 服务化经验 → DeepSeek-OCR-WebUI 移植手册

> 来源：只读 `~/Code/aws-gpu`（未改动、未跑任何远端命令）。2026-11-07 提炼。
> 证据格式 `路径:行号`，路径相对 `~/Code/aws-gpu/`。UOCR = `projects/unlimited-ocr`。
> 对照对象：本仓 `web_service_unified.py`（v4.1）+ `backends/cuda_backend.py`（HF transformers 跑 DeepSeek-OCR-2）。

**最重要的 5 条（TL;DR）**
1. 🔴 本仓前端 `Preview.vue` 用 `markdown-it({html: true})` + `v-html` 渲染**模型生成的 HTML**（来自用户上传的任意文档）⇒ 存储型/反射型 XSS 面。UOCR 的做法：预览进 `sandbox=""` iframe + CSP `default-src 'none'`（§G.4、§J P0-1）。
2. 🔴 本仓服务 `uvicorn.run(host="0.0.0.0")`、compose `"0.0.0.0:8001:8001"`、CORS `*` + credentials ⇒ 默认裸露。UOCR：一律 127.0.0.1，外网只经 Tunnel + Access，测试读 `/proc/net/tcp` 证明（§G.1）。
3. "跑通 = 产物有效，不是 200"：每页判据（复读 J6 / 坐标循环 J4 / 空页 / 截断），**不过的页照样返回但 `ok=false` + 四要素告警**（§C）。
4. health 的 `ready` = 模型能出**正确结果**（启动预热一页已知真值、召回 ≥ 0.85），不是"模型对象存在"（§D）。
5. 每条判据都要能被**变异**打红：`mutations.tsv` 三列 + 白名单副本执行器（§F.4）。

---

## A. API 设计

### A.1 端点列表（UOCR 门面）

| 端点 | 用途 | 证据 |
|---|---|---|
| `POST /api/ocr` | 同步：上传 PDF/图 ⇒ Markdown + 块 + 每页判据；≤ `MAX_PAGES_SYNC`(20) 页 | `UOCR/api/main.py:178-190` |
| `POST /api/ocr/stream` | NDJSON 逐页：`start → progress* → page* → done`，中途失败 `error`；≤ 200 页 | `UOCR/api/main.py:193-224` |
| `GET /api/health` | ready + 后端**实际生效值**逐条核对 | `UOCR/api/main.py:227-231` |
| `GET /api/capabilities` | 能做什么、**刻意不做**什么、已知弱项（带 issue 证据） | `UOCR/api/main.py:234-261` |
| `POST /api/warm` | 跑一页已知真值的合成页（完整链路），结果写进 health | `UOCR/api/main.py:264-268` |
| `GET /` | 静态 UI（`include_in_schema=False`） | `UOCR/api/main.py:171-175` |

要点：
- **同步与流式同一条代码路径**：`Engine.run()` 是生成器（start/page/done 事件），同步端点只是收集 `done` ⇒ 两个端点的判据/告警/Markdown 不可能分叉（`UOCR/api/engine.py:3-4, 297-306`）。
- **同步端点有自己的页数上限**：Cloudflare ~100 s 无响应字节就 524 ⇒ 同步 ≤ 20 页，超过回 413 `too_many_pages_for_sync` 并在 detail 里给 `use="/api/ocr/stream"`（`UOCR/api/documents.py:118-126`，`UOCR/api/schemas.py:48-50`）。
- **流式：输入错误必须在开流前以 HTTP 状态码返回**。做法：`first = next(gen)` 先把生成器推到第一个事件（校验/plan 在这一步），之后才 `StreamingResponse`（`UOCR/api/main.py:209-213`）。开流后失败只能 `{"type":"error",...四要素}` 一行，然后结束 —— "没有 done 就是失败"（`main.py:197-201, 217-223`）。
- **后端不可达在开流前 503**：`ENGINE.sglang.ping()` 失败直接抛 `BackendError(503, "backend_unavailable")`（`main.py:205-208`）。

### A.2 请求 schema：白名单字段 + 拒收未知字段

```python
# UOCR/api/main.py:47-49, 124-148（精简）
ALLOWED_FIELDS = frozenset({"file", "mode", "pages", "output"})
async def reject_foreign_fields(request: Request) -> None:
    # ★ 必须看原始请求：FastAPI 解析后的参数里根本没有未声明字段（被静默丢掉）
    names = set(request.query_params.keys())
    ctype = request.headers.get("content-type", "")
    if ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
        names |= set((await request.form()).keys())
    elif "json" in ctype:
        names |= set(json.loads(await request.body() or b"{}").keys())
    unknown = sorted(names - ALLOWED_FIELDS)
    if unknown:
        raise InputError(422, "unknown_field", "有不认识的字段（拼错了？）", actual=unknown, allowed=sorted(ALLOWED_FIELDS))
# 挂法：@app.post("/api/ocr", dependencies=[Depends(reject_foreign_fields)])
```

- 参数用 `Literal[...]` 收窄（`mode: Literal["auto","base","gundam"]`、`output: Literal["markdown","blocks","both"]`，`main.py:183-184`）。
- `pages="1-3,5"` 页码范围解析：`re.fullmatch`（不是 `re.match` + `$`）、1 起、倒序/越界/超长都 422/413 四要素（`UOCR/api/documents.py:48-69`）。
- **文件类型按文件头嗅探**，不信文件名/Content-Type（`documents.py:35-45`）：`%PDF-` / PNG magic / `\xff\xd8\xff` / `RIFF....WEBP`。
- **上传体积"多读 1 字节"判超限**，不把超大文件整读进内存（`main.py:151-157`）：`data = file.file.read(cap + 1); if len(data) > cap: 413`。

### A.3 响应 schema（pydantic）

- 关键模型：`OcrResponse{request_id, ok, mode_requested, mode_effective, mode_reason, output, source, markdown, raw, pages[PageOut], judges[DocJudges], warnings[WarningItem], timing, usage, backend}`（`UOCR/api/schemas.py:191-207`）。
- `ok=false` 时**内容照样返回**，原因在 `warnings`（`schemas.py:193`）。这是全仓核心原则："不过的页照样返回但标红 + 告警"（`main.py:10`）。
- `PageOut` 每页给：`index / source_page / ok / failed[] / content_chars / near_empty / no_coord_loop / truncated / bbox_bad / no_repetition / repetition{kind,period,extent_chars,zratio} / cut_by_repetition / blocks? / raw?`（`schemas.py:144-160`）。
- `Timing{read_ms, rasterize_ms, backend_ms, ttft_ms, convert_ms, total_ms}`（`schemas.py:174-180`）——分段计时，排障直接定位瓶颈。
- **所有响应模型 `extra="allow"`**：本仓两次踩过"engine 报了 ≠ API 报了"（pydantic `response_model` 静默丢未声明字段）；allow 只兜底，新字段仍必须声明，unit 用 OpenAPI 里必须出现字段名钉住（`schemas.py:6-8, 120-121`；测试 `UOCR/tests/unit/test_http_contract.py:369`）。

### A.4 错误响应四要素

统一形状 `{"detail": {"error": 机器码, "message": 人话, "actual": 实际值, "limit"/"max"/"allowed": 限制值, ...}}`：

```python
# UOCR/api/documents.py:26-32
class InputError(Exception):            # 4xx：调用方的错
    def __init__(self, status: int, error: str, message: str, **extra) -> None:
        super().__init__(message); self.status = status
        self.detail = {"error": error, "message": message, **extra}
# UOCR/api/backend.py:55-61  BackendError 同形（5xx/504）
# UOCR/api/main.py:93-121   四个 exception_handler：InputError / BackendError / RequestValidationError / Exception
```

- **FastAPI 原生 422 也改造成四要素**（字段 / 人话 / 实际值 / 允许值，`main.py:108-115`）。
- 兜底 `Exception` handler：`logger.exception` 记全栈 + 返回 `internal_error`，message 截 300 字（`main.py:118-121`）。
- 后端错误分类：OOM 单列 503 `backend_oom`（调用方处置不同：减页/换 base/等让位），4xx→422 `backend_rejected`，其余 502（`backend.py:64-72`）。
- Swagger 里用 `responses=_ERR` 给每个状态码写描述（`main.py:165-168`）。

已用错误码一览（便于对齐）：`empty_upload / upload_too_large / unsupported_media_type / bad_pdf / pdf_encrypted / pdf_no_pages / bad_pages_spec / page_out_of_range / too_many_pages / too_many_pages_for_sync / page_too_large / image_too_large / bad_image / raster_too_large / unknown_field / client_processor_rejected / invalid_request / backend_unavailable / backend_oom / backend_rejected / backend_error / backend_idle_timeout / backend_disconnected / backend_stream_error / request_deadline / internal_error`。

### A.5 Swagger / OpenAPI 写法

- `FastAPI(description=f"""...""")` 用 **f-string 把 Limits 常量直接插进文档**（`main.py:52-90`）⇒ 文档里的上限永远等于代码值，不会漂移。文档包含：怎么调（curl 示例 + Access 头）、端点表、参数、闸门、产物判据。
- 每个端点 `summary` + `description` 必填，unit 钉住（`test_http_contract.py:384` `test_every_api_endpoint_has_summary_and_description`）。
- `Form(..., description=..., examples=[...])` 给参数说明（`main.py:160-164`）；NDJSON 端点在 `responses={200: {"content": {"application/x-ndjson": {"example": ...}}}}` 给事件示例（`main.py:193-195`）。
- `SERVICE_TITLE` 是部署身份：调度器用 openapi title 判"这个端口上是谁"，与 registry 逐字相同（`schemas.py:18-20`）。

### A.6 request_id + loguru

```python
# UOCR/api/main.py:37-41
logger.remove()
logger.add(sys.stderr, level="INFO",
           format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level:<7}</level> | {extra} | {message}")
logger.add(LOG_DIR / "api.log", rotation="50 MB", retention=10, level="INFO", encoding="utf-8", enqueue=True)
# UOCR/api/engine.py:112-113
rid = uuid.uuid4().hex[:12]
log = logger.bind(request_id=rid)        # {extra} 里自动带 request_id
```

- `request_id` 进响应体（`schemas.py:192`）和流的 `start` 事件（`engine.py:121`）。
- 异常带栈：`log.opt(exception=err).error(...)`（`engine.py:170`）、`logger.exception(...)`。
- 规约钉子：AST 扫 `api/*.py` 禁止 `import logging`；推理端点必须是**同步 def**（FastAPI 只把同步端点丢线程池，`async def` 里跑阻塞推理会堵死事件循环）（`UOCR/tests/regression/test_defects.py:252-263`；变异 `UOCR/tests/mutations.tsv:10`）。
- uvicorn 用 `--no-access-log`（`UOCR/systemd/unlimited-ocr.service`），访问日志由业务日志按 request_id 记。

---

## B. 文档处理（PDF / 图片）

### B.1 两段式：plan（不栅格化的校验）+ rasterize（逐页生成器）

`UOCR/api/documents.py:7-10` 说明了动机：原先 200 页 ≈ 20 s 在开流前一次做完、全程不吐字节，并发时排后面的等 (k−1)×20 s ⇒ 撞 Cloudflare 100 s。

```python
# documents.py:91-106 plan()：毫秒级，所有不需要像素的闸门
if not data: 422 empty_upload
if len(data) > MAX_UPLOAD_MB: 413
kind = sniff(data) or 415
# PDF：fitz.open → needs_pass ⇒ 422 pdf_encrypted；page_count<1 ⇒ 422；parse_pages；_check_count；
#      逐页只读 page.rect 估像素（不渲染），r.width*zoom*r.height*zoom > MAX_PAGE_MPIX ⇒ 413 page_too_large
# 图片：PIL Image.open 只读头拿 (w,h)，> MAX_IMAGE_MPIX ⇒ 413（防解压炸弹），然后 im.verify()

# documents.py:173-200 rasterize()：逐页 yield，锁只包单页
with _RASTER_LOCK:
    pix = doc.load_page(no - 1).get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    png = pix.tobytes("png"); del pix
total += len(png)
if total > MAX_RASTER_MB * 2**20: raise InputError(413, "raster_too_large", ..., page=no)
yield no, ("image/png", png)
```

- **PyMuPDF 不保证线程安全（MuPDF 全局上下文）⇒ 全局一把锁**，但只包单页渲染，让并发长请求交替前进（`documents.py:4-5, 22, 173-200`）。
- **图片原字节直接交后端，不重编码**（"重编码 = 一次没校调过的预处理"）（`documents.py:6`）。对照：本仓 `_render_pdf_pages` 先 PNG → PIL → 再 PNG optimize → base64，多一次无收益的编解码。
- 流式下栅格化期间也能推心跳（engine 在 rasterize 循环里调 `beat()`，`engine.py:140-144`）。

### B.2 DPI 与页图尺寸

| 项 | UOCR 值 | 依据 |
|---|---|---|
| PDF DPI | **固定 300**，不开放成参数 | 上游 README `pdf_to_images` 同值；"没校调过的参数不进 API"（`schemas.py:58-59`） |
| A4@300 | 2479×3508 ≈ 8.7 MP | regression 用 PNG 头 IHDR 验宽高（`test_defects.py:276-281`） |
| 每页像素上限 | 40 MP（A3@300=17.4 MP） | 超过 413，**不偷偷降 DPI**（`schemas.py:51-52`） |
| 图片像素上限 | 40 MP，解码前读头判 | 防解压炸弹（`schemas.py:53-54`） |
| 页图累计字节 | 2048 MiB | 页图整份 base64 进请求体 ⇒ 门面峰值内存 ≈ 栅格化字节×3（`schemas.py:55-57`） |
| 上传 | 90 MiB | Cloudflare 请求体 ≤100 MB(=95.4 MiB) 留 multipart 余量（`schemas.py:42-43`） |

⚠️ 本仓当前 PDF 用 **144 DPI**（`web_service_unified.py:497`），与 DeepSeek-OCR 上游一致（本仓 `DeepSeek-OCR-master/DeepSeek-OCR-vllm/run_dpsk_ocr_pdf.py:64` `pdf_to_images_high_quality(pdf_path, dpi=144)`）⇒ **不要照抄 UOCR 的 300**（那是 Unlimited-OCR 上游的值）。可移植的是"做法"：DPI 取上游值、不开放成参数、写进 `Limits`、用 PNG IHDR 宽高钉进 regression（A4@144 ≈ 1190×1684），变异把它改掉必须红（对照 `mutations.tsv:24`）。

### B.3 多页、长文档、模式选择

- `mode=auto`：单页 ⇒ gundam（动态切图，小字稳），多页 ⇒ base（每页一张 1024² 全局图，~273 视觉 token/页），`mode_reason` 写进响应（`engine.py:27-34`，`schemas.py:115-117`）。DeepSeek-OCR-2 也有 base/gundam(crop_mode) 概念，可直接照搬 "auto + mode_effective + mode_reason" 的透明化做法。
- **输出预算随页数线性**：`max_tokens = 8000 × 页数`，**不设全局封顶** —— 原来的 `39321` 封顶是"隐藏的页数闸门"，100/200 页文档都在第 88 页 finish=length、后面全空（`lib/ocr/request.py:34-41`）。预算真用完 ⇒ `output_budget_exhausted` 告警，带 `pages_missing`（`engine.py:261-264`）。
- Unlimited-OCR 是"多页一次请求"的模型；**DeepSeek-OCR-2 是单图模型**，长文档在本仓应是"逐页调用 + 页级结果拼接"，可移植的是：逐页事件流、页级判据、整请求截止随页数线性、一页坏不拖垮后面的页。

### B.4 超时 / 截止 / 取消

```python
# UOCR/api/schemas.py:75-77
def request_deadline_s(n_pages: int) -> float:
    return max(float(Limits.REQUEST_DEADLINE_S), Limits.DEADLINE_PER_PAGE_S * max(n_pages, 1))   # max(1200, 8×页数)
```

- **三层时间闸**：
  1. 整请求墙钟（含栅格化与续做段）：`time.monotonic() > deadline` ⇒ 504 `request_deadline`（`engine.py:137, 166-171`）。
  2. 后端空闲：**首个 SSE 行之后**相邻两行 > `BACKEND_IDLE_S`(120 s) ⇒ 504 `backend_idle_timeout`；首行之前（排队/prefill）不算卡住（`backend.py:134-145`，`schemas.py:60-62`）。依据：1237 个成功请求 ttft 最大 22.2 s。
  3. 流式保活心跳：`HEARTBEAT_S=15` 内没推过事件就推 `{"type":"progress","stage","pages_done","pages_total","elapsed_s"}`（`engine.py:126-134`，`schemas.py:68-70`）。
- **取消 = 关连接**：`finally: stream.close()`；不 close ⇒ 生成在后端继续跑完 8000 token（`engine.py:204-207`）。读线程 + 队列 + `stop` Event 实现（`backend.py:93-155`），后端静默时每 `TICK_S=0.25` 交一个 `None` 节拍，让上层能推心跳/判截止。
- 所有阈值每次调用**现读 `Limits`** ⇒ 测试里 monkeypatch 调小即可覆盖（`backend.py:103`，`schemas.py:76`）。

对本仓（HF transformers `model.infer` 同步阻塞）：做不到 token 级取消，但能做到：①每页一个截止 ②页间检查客户端是否断开（`await request.is_disconnected()`）③`max_new_tokens`/stopping criteria 兜住单页上限（见 C）。

---

## C. 推理质量防护

### C.1 判据体系（lib/ocr/judges.py，阈值集中在 `Limits`，`lib/ocr/judges.py:29-51`）

| 判据 | 含义 | 实现 |
|---|---|---|
| J1 | 输出 `<PAGE>` 数 == 请求页数（分页错位 #107） | `judges.py:148` |
| J2 | 非空转写：有真值时 输出/真值内容字符 ≥ 0.3，否则 ≥ 50 字 | `judges.py:154-160` |
| J3 | `finish_reason == "stop"`（length = 截断/复读到上限） | `judges.py:149` |
| J4 | 无坐标循环（`[23,268,268,268…`、bbox 超过 4 个数） | `judges.py:23-26, 70-73` |
| J6 | 尾部无复读（verbatim / template / perturbed） | `judges.py:104-124` |
| N1 | 负对照（空白页）内容字符 ≤ 20 —— 编造内容即红 | `judges.py:154-155` |
| recall | 已知真值页的字符召回（多重集交/真值字数）≥ 0.85 | `judges.py:169-174` |

- `failed()` 用 `v is False`，读数里的 0 不算失败（`judges.py:164-166`）。
- `content_chars`：NFKC 后 `isalnum()` 计数（中文按字），标点/空白/版面符号不计（`judges.py:65-67`）。
- `strip_layout`：**先整段去掉块头（类型词+bbox）**，再剥其余标签 —— 曾因块类型词 `text` 留在内容里每块多算 4 字（`judges.py:54-62`）。DeepSeek-OCR 的 grounding 输出 `<|ref|>…<|/ref|><|det|>[[…]]<|/det|>` 同理：判"内容字数"前先剥 ref/det。

### C.2 复读检测（J6，可直接移植的纯函数）

```python
# lib/ocr/judges.py:79-124（精简）
LOOP_MIN_EXTENT=1000; LOOP_TAIL_CHARS=3000; LOOP_MAX_PERIOD=400; LOOP_MATCH_MIN=0.97
LOOP_ZRATIO_MAX=0.05; LOOP_ZRATIO_MIN_CHARS=1500; NUM=re.compile(r"\d+")

def _tail_period(s):            # 尾部最小近似周期（至少 3 个周期）
    t = s[-LOOP_TAIL_CHARS:]; n = len(t)
    for p in range(1, min(LOOP_MAX_PERIOD, n // 3) + 1):
        if sum(a == b for a, b in zip(t, t[p:])) >= LOOP_MATCH_MIN * (n - p):
            return p

def _extent(s, p, window=200):  # 从尾往前按周期 p 的连续复读长度，滑窗失配 > 3% 停
    ...

def repetition(raw):
    for kind, text in (("verbatim", raw), ("template", NUM.sub("0", raw))):   # template：数字归一后才成周期（递增编号）
        p = _tail_period(text); ext = _extent(text, p) if p else 0
        exact = kind == "template" or (p and raw[-p:] == raw[-2*p:-p])          # 逐字要求最后两周期完全相同
        if ext >= LOOP_MIN_EXTENT and exact: return {"kind": kind, "period": p, "extent_chars": ext}
    z = zratio(raw)             # 第二检测器：尾部 3000 字（数字归一）zlib 压缩比
    if z is not None and z <= LOOP_ZRATIO_MAX: return {"kind": "perturbed", "zratio": z, ...}
    return {"kind": None, ...}
```

- **阈值是定标出来的**（`judges.py:37-48`）：883 的 272 条原始输出，干净页 214 + 负对照 30 一条都检不出周期；复读侧最小 3397/4625 ⇒ 1000 落在缝里。压缩比：漏判复读 0.026~0.050，干净页合法最小 0.110（数字表格）⇒ 0.05 有 2 倍余量，"宁漏不误切"。
- **为什么 J3 不够**：防复读 processor/页守卫生效后，复读页被强制 EOS ⇒ finish=stop ⇒ J3 抓不到，只有 J6 能标出来（`judges.py:11`，`lib/ocr/pages.py:89-90`）。
- 对本仓：DeepSeek-OCR 官方 vLLM 路径显式挂了防复读 processor：`NoRepeatNGramLogitsProcessor(ngram_size=20, window_size=50, whitelist_token_ids={128821, 128822})`（`<td>`/`</td>` 白名单，本仓 `DeepSeek-OCR-master/DeepSeek-OCR-vllm/run_dpsk_ocr_pdf.py:46`，实现 `process/ngram_norepeat.py:7-19`）。HF `model.infer` 路径（本仓在用）是否有等价防复读【未核实：需 grep HF 缓存里 DeepSeek-OCR-2 的 `modeling_*.py` 的 `generate(` 参数，如 `no_repeat_ngram_size`】。无论有没有，J6 后验判据都是必需品 —— UOCR 的教训正是"processor 以为开了、其实静默没注入"（§I-1）。

### C.3 流式复读截断 + 续做（UOCR 最有价值的工程点之一）

`UOCR/api/engine.py:152-231`：
1. 当前页每增长 `CUT_CHECK_EVERY_CHARS=500` 字检一次 `repetition(seg)`（每次 ~0.03 s CPU，`judges.py:50`）。
2. 检出 ⇒ `break` + `stream.close()` 真断后端连接（GPU 不再白跑），本页标 `cut_by_repetition=true, truncated=true`，finish 记 `repetition_cut`（**不冒充 stop**）。
3. 剩余页**另起一个请求**续做 ⇒ 一页复读不拖垮后面的页。
4. **G1 进展不变式**：续做起点必须严格前进，否则 `RuntimeError(no_progress)` —— 一个页号算错的变异曾让测试挂死 2582 s（`engine.py:217-219`）。

本仓移植形态（HF 同步推理）：用 `transformers.StoppingCriteria` 在 generate 中按每 N token 调 `repetition(decoded_tail)` ⇒ 返回 True 停止；结果标 `cut_by_repetition`。或在 `model.infer` 外层做不到时，至少设 `max_new_tokens` 并对结果做 J6 后验。

### C.4 finish_reason / 空产物 / 流内错误

- SSE 里的 `{"error": …}` **必须当失败，不能当空输出**（否则被 J2 判成"识别差"混进质量读数）（`lib/ocr/request.py:113-150`，`engine.py:232-235`）。
- 流结束却无 `finish_reason` ⇒ 502 `backend_disconnected`（`engine.py:236-238`）。
- `near_empty`（≤20 字）是**读数不是失败**：空白页的正确答案就是空，服务只能如实标出 + `page_near_empty` 告警交调用方判断（`lib/ocr/pages.py:63-66`，`engine.py:73-75`）。
- 告警同一件事不重复：截断页只出 `page_repetition_cut`，不再出 `page_truncated`（`engine.py:57-61, 71`）。

### C.5 grounding / 坐标

- bbox 归一到 0–1000；`bbox_ok` = 恰好 4 个整数、都在 0–1000、x1≤x2、y1≤y2；不合格的块**照样保留内容**，`bbox_bad` 计数（读数，不判失败）（`lib/ocr/pages.py:40-59`，`schemas.py:135-141`）。
- J4 坐标循环：同一个数连续 ≥6 次 `\b(\d{1,4})\b(?:\s*,\s*\1\b){5,}`，或一个 `[...]` 里 >4 个数（`judges.py:26, 70-73`）。DeepSeek-OCR 的 `<|det|>[[x1,y1,x2,y2]]<|/det|>` 同样是 0–999 归一坐标，可直接复用。
- 对本仓：`web_service_unified.py:310` 用 `ast.literal_eval(coords_str)` 解析坐标 —— 比 eval 安全，但没有 bbox 合法性校验与坐标循环检测；建议换成正则提数 + `bbox_ok` + J4。

### C.6 Markdown 后处理

- **一律走官方后处理脚本，不自写转换器**：自写的话测的是自己的转换器，不是模型（`lib/ocr/convert.py:1-8`）。
- **钉 blob**：加载前 `git hash-object` 同算法校验 sha1，对不上拒绝加载（`convert.py:24-44`）；缺失/失败 ⇒ `markdown_unavailable` / `markdown_convert_failed` 告警，块格式照常返回，**不 500**（`engine.py:268-280`，测试 `test_http_contract.py:360`）。
- 模块全局 `DROP_LABELS` 变体用锁 + finally 还原（`convert.py:47-58`）。
- 对本仓：DeepSeek-OCR-2 的 `model.infer(..., eval_mode=True)` 输出已是 Markdown + ref/det 标签；`clean_grounding_text` 是自写清洗 ⇒ 至少要有"清洗前后内容字数比"的读数，清洗吃掉大量内容时告警。

---

## D. 健康检查与预热

### D.1 /health 的内容（`UOCR/api/engine.py:353-392`，schema `schemas.py:218-229`）

```json
{"status": "ok|starting|backend_down|misconfigured|error",
 "ready": true,                      // = 后端可达 ∧ 生效值无 fatal ∧ 启动预热产物判据全过 —— 调度层只认这个
 "service": "...", "version": "...",
 "backend": {"url","reachable","why","pid","env","argv","server_info","log","probe","hf_revision","patch"},
 "checks": [{"name","ok": true|false|null,"actual","expected","source","severity"}],
 "problems": [{"code","message","actual","expected","severity":"fatal|warn"}],
 "warm": {"done","ok","wall_s","judges","recall","failed","at","why"},
 "inflight": 0, "limits": {...}}
```

- **`ok: null` = 未验证，不是通过**（`main.py:228-229`，`backend.py:3, 13-14`）。读不到的项单列 `unverified:*` warn。
- **核的是"实际生效值"不是"以为设了的值"**：env 读 `/proc/<MainPID>/environ`、argv 读 `/proc/<pid>/cmdline`、版本/rope 用同 venv 子进程探针、HF revision 读模型目录下的标记文件（`backend.py:3-11, 256-271, 351-368`）。
- 采集结果缓存 30 s 或 pid 变化重采（health 每 2 s 被调度层问一次）（`engine.py:23-24, 324-330`）。
- 启动日志证据：倒读整份日志找"本 pid 的启动标记"（原只读末 4 MiB ⇒ 服务跑久标记被挤出 ⇒ health 误判 misconfigured）（`backend.py:183-221`）。
- **期望值与启动脚本是同一组事实的两处**：脚本负责"设"，health 负责"核"，regression 执行启动脚本 dry-run 拿真实 env/argv 与 `EXPECTED_*` 比（不是 grep 文本）（`schemas.py:3-5`，`test_defects.py:72-108`）。

对本仓：当前 `/health` 只报队列深度和 `model_loaded: backend is not None`（`web_service_unified.py:340-402`），模型对象存在 ≠ 能出正确结果。

### D.2 启动预热（行为证据）

```python
# UOCR/api/engine.py:332-351
def start_background(self):
    def _bg():
        deadline = time.time() + READY_WAIT_S            # 900 s
        while time.time() < deadline:
            if self.sglang.ping()[0]: break
            time.sleep(3)
        else:
            self.warm_state = {"done": False, "ok": False, "why": "900 s 内没 ready"}; return
        try:
            self.effective(with_probe=True); self.warm()
        except Exception as e:                           # 后台线程：记全栈 + 进 health，不让线程静默死掉
            logger.exception("启动预热失败")
            self.warm_state = {"done": True, "ok": False, "why": f"{type(e).__name__}: {e}"[:300]}
    threading.Thread(target=_bg, name="uocr-warm", daemon=True).start()

# engine.py:309-322 warm()：合成页走完整链路
r = self.ocr(documents.warm_pdf(), filename="warm.pdf", mode="auto", pages_spec=None, output="both")
recall = judges.char_recall(documents.WARM_TRUTH, r["raw"])
j = judges.judge(r["raw"], r["judges"]["finish_reason"], expect_pages=1)
j["recall_ok"] = recall >= 0.85; j["markdown_ok"] = bool(r["markdown"].strip())
```

- **合成预热页**：PyMuPDF 现排中英混排文字（`china-s` 内置 CJK 字体），真值就是排进去的文字，不依赖任何解析器（`documents.py:204-226`）。e2e 也用同一个函数造多页/空白页素材。
- 坑：两端对齐文本框会把西文/数字排开（"1 1 1 1"），比对前去空白（`UOCR/tests/e2e/test_http.py:57-61`）。

### D.3 显存实测峰值方法

- 不估算，**实测**：同一文档 50/100/200 页单请求，整卡显存 34743 → 34745 MiB（不随页数涨）⇒ 才把 `MAX_PAGES` 放到 200，并且"200 是测过的最大点，不越过"（`schemas.py:44-47`）。
- "闸门设在测过的点上；要抬先实测那一档"（`schemas.py:39`）。
- KV 预算是**算出来的**：`window_kv_worst = (窗口页 + 1) × prompt 上限 + 窗口页 × 输出 p95`，health 读启动日志 `max_total_num_tokens` 与 `KV_NEED_TOKENS` 比，池不够 ⇒ fatal（`lib/ocr/request.py:44-77`，`backend.py:313-317`）。
- 门面内存：页图 base64 进请求体 ⇒ 峰值 ≈ 栅格化字节×3（`schemas.py:55-57`），用 remote/893 R 段实测扫描件 200 页 RSS 定 `MAX_RASTER_MB`。

（显存采样脚本细节见 H 节 remote/893。）

---

## E. 并发与调度

### E.1 门面内

- 推理端点是**同步 def**，FastAPI 丢线程池；`uvicorn --workers 1`（单进程，状态/模型只一份）（`UOCR/systemd/unlimited-ocr.service`）。
- 并发上限在**后端**：SGLang `--max-running-requests 8`、`--cuda-graph-max-bs-decode 8`，且两者必须同值（桶外 batch 形状退回 eager = 坏产物 #114）（`schemas.py:98-105`，变异 `mutations.tsv:70`）。
- `inflight` 计数用 `threading.Lock`，在 health 里暴露（`engine.py:85-86, 162-163, 206-207`）。
- 栅格化全局锁只包单页（B.1）。

### E.2 调度层（router）：`UOCR/router/app.py` + `lib/dispatch`

- 同机 127.0.0.1:10880，入口域名指向它；现在只挂一路，但"一路也要调度层"：以后加路不改 Tunnel/调用方；drain 文件做维护摘除（`router/app.py:1-4`）。
- **按工作量派单**：代价 = (在途工作量 + 本次工作量) × 每单位服务时间（EWMA）；OCR 的工作量 = **页数**（表单 `pages` 数它，否则 PyMuPDF 数页，图片=1）；自己切 multipart（二进制安全）（`router/app.py:6-11, 32-93`）。
- 健康探测：调度层只认后端 `/api/health` 的 `status=ok ∧ ready=true`；后端没起 ⇒ 不派、返回门面错误（`UOCR/systemd/unlimited-ocr-router.service` 注释）。
- `max_tries=2` 故障转移、`cold_s` 冷启动估计（`router/app.py:98-114`）。
- 响应带 `served_by` / `x-served-by`（e2e `test_router_serves_ocr_and_tags_served_by`，`tests/e2e/test_http.py:199`）。

`lib/dispatch/app.py` 细节：
- **健康判定**：`default_health = status==200 ∧ d.status=="ok" ∧ d.ready`（`lib/dispatch/app.py:49-52`）。
- **后台轮询，热路径不同步问后端**：`poll_forever()` 每 `health_every_s` 问一次 `/api/health`（timeout 4 s），"连不上"与"连上但不健康"写法不同（降级留痕）（`app.py:138-163`）。
- **drain 开关**：`<drain_dir>/drain-<id>` 或 `drain-<name>` 任一存在 ⇒ 不派新单，在飞的照常做完；按 id **或** 名字都认（曾按名字建 drain 文件、调度层没读到）（`app.py:45-47, 144-146`）。
- **可重试判定**：`None`(连不上/超时) 或 ≥500 ⇒ 换下一台；4xx 是调用方的错不重试；例外：非 primary 回 401/403 是"调度层→副本那一跳"的 Access 问题 ⇒ 回落（`lib/dispatch/policy.py:130-135`）。
- **流式只能在拿到响应头之前回落**（`app.py:77` 注释）⇒ 这就是门面要"输入错误/后端不可达在开流前以状态码返回"的原因（§A.1）。
- `/api/router` 暴露每台的 `ewma_service_s / rate_s_per_unit / inflight_units / drained / peer_busy`（`app.py:328-329`）。

对本仓：现状是 `asyncio.Semaphore(1)` + 每客户端/每 IP 限流 + 队列深度（`web_service_unified.py:231-232, 404-430`）。单卡单模型下 Semaphore(1) 合理，但：①`async def` 端点里 `await file.read()` 之后 `run_in_executor` 是对的 ②缺"整请求截止"与"排队等待上限" ③`/health` 的 status 应该反映"能否出活"而不只是队列。

---

## F. 测试体系

### F.1 分层与入口

| 层 | 目录 | 输入 | 不可达时 |
|---|---|---|---|
| unit | `UOCR/tests/unit/` | 真 HTTP 替身后端 + FastAPI TestClient | 不依赖 GPU |
| regression | `UOCR/tests/regression/test_defects.py` | **执行结果**（启动脚本 dry-run / 真栅格化 / 路由对象）或机器上装出来的东西 | 机器专属输入不在 ⇒ skip 并写明"未检查"（skip ≠ 通过） |
| e2e | `UOCR/tests/e2e/test_http.py` | 真门面/真后端/真调度层，**判产物不判状态码** | 不可达 skip；可达但不 ready ⇒ **fail**（`test_http.py:44-54`） |

- 每个测试文件头 `# TESTCOUNT: N`（自报用例数）+ `# TESTDEPS: ...`（`test_defects.py:2-3`，`test_http.py:2-3`）。
- regression 文件头是"钉子 ↔ 缺陷"表，每条对应一个已发生或上游已证实的缺陷（`test_defects.py:4-19`）。

### F.2 fake 后端：真 HTTP、只替"模型"

`UOCR/tests/unit/_fakes.py:1-117`：
- stdlib `ThreadingHTTPServer(("127.0.0.1", 0))` 起替身，门面走**真 httpx 客户端 + 真 SSE 解析**。
- `fake.script = lambda body: {...}` 按请求定制回答：`raw / finish / status / error_body / stream_error / chunk / pace / hang / hang_after_first / delay / usage / forever`，覆盖排队、空闲超时、永不结束、流中错误、OOM 等形态。
- `fake.bodies` 记下门面**真正发出去的请求体** ⇒ 安全判据看字节不看源码；`fake.aborted` 统计客户端中途断开 ⇒ 证明"后端连接真的被关了"。
- conftest：`app_client` fixture 把 `main.ENGINE` 换成指向替身的 Engine、注入 `fake_proc()`（与官方脚本同 API 的假模块），**不跑 startup**（`UOCR/tests/unit/conftest.py:45-58`）。

对本仓：`backend.infer(prompt, image_path)` 是进程内调用 ⇒ 替身更简单：一个 `FakeBackend` 类，`script(prompt, image) -> str`，可模拟复读串、坐标循环串、空串、抛 OOM、sleep 超时。

### F.3 代表性用例（直接抄题目）

`UOCR/tests/unit/test_http_contract.py`：`test_unknown_field_is_422_not_silently_ignored`(111) · `test_bad_mode_is_422_with_four_elements`(117) · `test_unsupported_type_is_415`(123) · `test_upload_too_large_is_413`(136) · `test_repetition_page_with_finish_stop_is_still_flagged`(149) · `test_repetition_is_cut_midstream_and_backend_stream_is_closed`(185) · `test_cut_page_does_not_take_down_the_pages_after_it`(201) · `test_long_plain_page_is_not_cut`(220，负对照：长正常页不许误切) · `test_backend_that_goes_silent_hits_the_idle_timeout`(256) · `test_backend_that_never_finishes_hits_the_request_deadline`(270) · `test_blank_page_is_marked_near_empty_with_warning`(300) · `test_backend_oom_is_503_backend_oom`(327) · `test_stream_backend_error_midway_is_an_error_event_and_no_done`(344) · `test_markdown_convert_failure_is_a_warning_not_a_500`(360) · `test_openapi_declares_the_fields_we_return`(369) · `test_stream_sends_progress_while_backend_is_silent`(454) · `test_queue_wait_before_first_token_is_not_an_idle_timeout`(467)。

e2e（`tests/e2e/test_http.py`）：`test_blank_page_does_not_fabricate_content`(117) · `test_concurrency_4_no_coord_loop_and_no_crosstalk`(132，4 并发各自对得上自己的真值 = 无串味) · `test_decode_batch_shrinking_mid_flight_stays_on_the_graph`(140，一长三短同时发) · `test_only_loopback_listens_on_our_ports`(185，读 `/proc/net/tcp` 内核视角验证只绑 127.0.0.1)。

### F.4 变异验证 mutations.tsv

格式（`UOCR/tests/mutations.tsv:1-4`）：每行三列 TAB 分隔 `相对项目的文件 \t sed 表达式 \t 测试路径`；**上一行 `#` 注释写它对应的缺陷**（runner 只认三列，注释不能放第 4 列）。示例：

```tsv
# #114 坐标循环页不再告警（静默）
api/engine.py	s/    if not v.no_coord_loop:/    if False:/	tests/unit/test_http_contract.py
# DPI 悄悄变了
api/schemas.py	s/    DPI = 300$/    DPI = 200/	tests/regression/test_defects.py
# 推理端点变 async（堵死事件循环）
api/main.py	s/^def ocr(file/async def ocr(file/	tests/regression/test_defects.py
# 门面绑 0.0.0.0
systemd/unlimited-ocr.service	s/--host 127.0.0.1 --port 10800/--host 0.0.0.0 --port 10800/	tests/regression/test_defects.py
```

执行器 `remote/850-mutation-run.sh`（61 行）要点：
1. **白名单副本**：只拷 `api/ tests/ bin/ router/ systemd/ ui/` + 需要的 lib；副本 > 500 MB 或根盘剩余 < 50 GB 拒绝；`trap 'rm -rf "$W"' EXIT`（`850:8-11, 19-35`）—— 教训：临时脚本 `cp -r` 整个项目（含 .venv/权重）写满 969 GB 根盘。
2. `export PYTHONDONTWRITEBYTECODE=1`：pyc 只按 mtime(整秒)+大小判过期，等长变异同秒改坏又还原 ⇒ 跑到旧 pyc ⇒ 假红/假存活（`850:14-16`）。
3. 先跑原样，**原样不绿就退出**（`850:47-50`）。
4. 逐条 `cp orig → sed -i → cmp -s`：没改到任何东西 ⇒ "⚠️ 未落地"（变异不存在 ≠ 没变红）（`850:52-58`）。
5. 每次 pytest 套 `timeout 300`；124 = 挂起 ⇒ 记 failed（挂起说明判据抓到了行为变化）（`850:37-45`）。
6. 汇总 `n 条 · 变红 · 未落地 · 存活`（`850:60-61`）。

本仓本地版（无需远端）：

```bash
#!/usr/bin/env bash
# scripts/mutate.sh —— 在临时副本里逐条改坏 → 指定测试必须红
set -uo pipefail
export PYTHONDONTWRITEBYTECODE=1
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
rsync -a --exclude .venv --exclude node_modules --exclude models ./ "$W/"
run() { (cd "$W" && timeout 300 uv run pytest -q -p no:cacheprovider "$1" 2>&1 | tail -1); }
while IFS=$'\t' read -r f expr t; do
  case "$f" in ''|\#*) continue;; esac
  cp "$W/$f" "$W/$f.orig"; sed -i '' "$expr" "$W/$f"     # macOS sed；Linux 用 sed -i
  if cmp -s "$W/$f" "$W/$f.orig"; then echo "⚠️ 未落地 $f $expr"
  else echo "[$f] $expr ⇒ $(run "$t")"; fi
  mv "$W/$f.orig" "$W/$f"
done < tests/mutations.tsv
```

---

## G. 部署

### G.1 绑 127.0.0.1（铁律，带可执行证明）

- 规约：`aws-gpu/CLAUDE.md:21-22`（铁律 5："很多上游默认 0.0.0.0，启动脚本里显式覆盖，不要顺手改"）、`CLAUDE.md:61`（API 规约 3）。
- 三个进程全绑回环：门面 `--host 127.0.0.1 --port 10800`、SGLang `--host 127.0.0.1`（`EXPECTED_ARGS`，`schemas.py:98-99`）、调度层 `--host 127.0.0.1 --port 10880`（各 systemd unit 的 `ExecStart`）。
- **三层判据**：① regression 读仓库 unit 文件与启动脚本 dry-run 的 argv（`test_defects.py:110, 227`）② health 读 `/get_server_info.host` 与 `/proc/<pid>/cmdline`（`backend.py:295-297`）③ e2e 读内核 `/proc/net/tcp{,6}` 的 LISTEN 行，只允许 `0100007F`（`tests/e2e/test_http.py:185-196`）。变异：把 unit / 启动脚本改成 0.0.0.0 必须红（`mutations.tsv:34, 38`）。
- 对本仓：`web_service_unified.py:583` `uvicorn.run(app, host="0.0.0.0")`；`docker-compose.gpu.yml:12` `"0.0.0.0:8001:8001"`；`docker-compose.yml:8` `"8001:8001"`（Docker 默认就是所有接口）。Docker 场景的等价写法：容器内绑 0.0.0.0（否则端口映射不通），**宿主映射写 `"127.0.0.1:8001:8001"`**；host 改为 env `HOST`（默认 `127.0.0.1`），用户显式指定才放开 —— 且不改写用户指定的值。

### G.2 systemd unit（`UOCR/systemd/*.service`）

| 要点 | 写法 | 为什么 |
|---|---|---|
| 门面 `Wants=` 后端，不用 `Requires=` | `Wants=unlimited-ocr-sglang.service` | 后端崩了门面照样在，health 报 `backend_down`、请求回 503 四要素，而不是门面跟着消失（SERVICE.md:29） |
| 后端 `PartOf=` 门面 | `PartOf=unlimited-ocr.service` | 随门面起停 |
| 前置检查失败不重启 | 启动脚本 `exit 78` + `RestartPreventExitStatus=78` | 缺安全补丁/编译链/权重校验时重启也只会再失败且刷屏（`unlimited-ocr-sglang.service` 注释、`bin/sglang-launch.sh:7, 86-89`） |
| 启动重试有限 | `StartLimitIntervalSec=900` `StartLimitBurst=3` | 共卡显存抖动时允许重试，但 15 min 最多 3 次 |
| 单 worker、关访问日志 | `uvicorn main:app --host 127.0.0.1 --port 10800 --workers 1 --no-access-log` | 模型只一份；日志走 loguru + request_id |
| 回环不走代理 | `Environment=no_proxy=127.0.0.1,localhost` + httpx `trust_env=False` | 机器上设了 http_proxy 时 httpx 默认会走代理（`backend.py:80-81`，上游 #105） |
| 秘密不进 unit | `EnvironmentFile=-/etc/gpu-stack/<svc>.env`（`-` = 文件可缺） | 见 §H.6 deepseek-ocr 明文 key 事故 |
| 进程 env 只含白名单 | 启动脚本 `exec env -i "${ENVS[@]}" python ...` | health 读 `/proc/<pid>/environ` 核对时没有"从别处漏进来的"值（SERVICE.md:33，`sglang-launch.sh:112`） |
| 启动标记 | `echo "... GPU-STACK-SGLANG-START pid=$$ ..."` 后 `exec`（pid 不变） | health 只分析本次进程的日志段（`sglang-launch.sh:111`） |
| 启动脚本 dry-run | `UOCR_DRY_RUN=1` 打印将交给进程的 env 与 argv、不 exec | regression **执行**它核对，而不是 grep 脚本文本（`sglang-launch.sh:6, 91`） |

对本仓：仓库里的 `deepseek-ocr.service` 是 `User=neo` + conda 路径 + `0.0.0.0` 的 `web_service.py`（旧版入口），且无 `EnvironmentFile`。建议改成：`ExecStart=... uvicorn web_service_unified:app --host 127.0.0.1 --port 8001 --workers 1 --no-access-log` + `EnvironmentFile=-/etc/deepseek-ocr-webui.env`（chmod 600）+ regression 钉住。

### G.3 Cloudflare Tunnel + Zero Trust Access 的关系

- 铁律 4：对外暴露必须 **Tunnel + Access 两件套**；只做 tunnel = 裸奔。加完用 `./bin/gpu health` 确认未带凭证返回 **302**（登录页）；**返回 200 是事故**（`aws-gpu/CLAUDE.md:18-19`）。
- 链路：`uocr.aws.xin ─Tunnel+ZT─▶ router:10880 ─▶ 门面:10800 ─▶ SGLang:10810`（SERVICE.md:14）；SGLang 端口**不进 Tunnel**。机器安全组入站 **0 条**，只出站（SSM + cloudflared）（`registry.yaml:337` sg `gpu-stack-l40s-ocr-noingress`）。
- 浏览器：登录 ZT 后直接 Swagger *Try it out*；脚本：带 `CF-Access-Client-Id` / `CF-Access-Client-Secret` service token 头（`main.py:51, 58-63`）。
- 验收：`registry.yaml:11184` "未带凭证 `/`、`/api/health`、`/docs`、`/openapi.json` 全部 302；带 service token `/api/health` 200"。⚠️ `/docs` 与 `/openapi.json` 也要受保护 —— 逐个路径验。
- Access bypass 的路径下，**应用层 key 是唯一防线** ⇒ 那条路径的**每个**端点都要校验（曾漏过一个，已加对称性 e2e）（`aws-gpu/README.md` 硬件与接入节）。
- Pages 的 `<name>.pages.dev` 是独立入口，必须单独建 Access（`registry.yaml:11305-11306`）。

对本仓（Neo 在香港，Cloudflare hkg 直连）：若要公网访问，同样 `cloudflared` 指向 `127.0.0.1:8001` + Access 应用（邮箱策略 + service token 给脚本/MCP）；`/docs`、`/openapi.json`、`/health` 全部纳入 302 验收。

### G.4 UI 安全（Markdown 预览）

`UOCR/ui/index.html:208-209`：
```html
<!-- 预览放进无脚本沙箱：表格是模型生成的 HTML（来自调用方上传的任意文档）⇒ 绝不直接塞进本页 innerHTML -->
<iframe id="mdFrame" class="frame" sandbox="" title="Markdown 预览"></iframe>
```
`UOCR/ui/index.html:722`：iframe 的 srcdoc 头部加 `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`。SERVICE.md:63 同说明。

对本仓：`frontend/src/components/preview/Preview.vue:121` `v-html="renderedMd"`，`:246-247` `new MarkdownIt({ html: true, ... })` —— 模型从图片里"读出"的 `<img src=x onerror=...>` / `<script>` 会原样进 DOM。两种修法（§J P0-1）。

### G.5 Docker

UOCR 本身**不用 Docker**（systemd + uv venv）；理由是：推理 venv 要逐字节可复现（`uv pip compile --exclude-newer <日期>` 锁文件 + `uv pip sync`，`remote/881-uocr-install.sh:21, 79-98`），门面与推理分两个 venv（门面不 import torch/sglang，SERVICE.md:30）。可移植到本仓 Dockerfile 的点：
- 依赖锁定到日期（`--exclude-newer`）+ 关键包版本断言（`881:120-124` 断言 nvcc 与 torch runtime 主次版本一致，否则 JIT 首请求才死）。
- 权重钉 revision + `sha256sum` 写 `SHA256SUMS.gpu-stack` + `REVISION.gpu-stack` 标记文件，health 读它报 `hf_revision`（`881:234-244`，`backend.py:263-268`）。本仓 `cuda_backend.py` 用 ModelScope `revision='master'` / HF 默认分支 ⇒ 不可复现。
- `HEALTHCHECK` 现在是 `curl -f /health`（`Dockerfile.v4.0:49`）⇒ 只证明进程在。应改成判 `ready==true`：`curl -fsS localhost:8001/health | python -c 'import sys,json; sys.exit(0 if json.load(sys.stdin).get("ready") else 1)'`。

---

## H. EC2 GPU 验证流程

### H.1 机型 / region / AMI

| 项 | 实际选择 | 证据 |
|---|---|---|
| OCR 专机 | `g6e.xlarge`（1× L40S 46068 MiB · 4 vCPU · 30 GiB RAM），东京 `ap-northeast-1a`，$2.699/h（us-east-1 同型 $1.861，+45%） | `registry.yaml:330-347` |
| 为什么换 region | us-east-1 g6e.xlarge 4 AZ × 63 轮全 ICE；东京第 1 轮抢到；新加坡整个 region 不卖 g6e | `registry.yaml:324-325` |
| 容量判断 | 先分清"这个 AZ 卖不卖"（`describe-instance-type-offerings`）vs "有没有物理空位"；us-east-1 L40S 长期 80–97% 利用率是结构性紧张 | `aws-gpu/CLAUDE.md:82-96` |
| 抢容量 | `bin/hunt-capacity --type g6e.4xlarge --region R`（只 run-instances，不碰现有资源；换 region 要同时给子网/SG/AMI） | `bin/hunt-capacity:4-22` |
| AMI | DLAMI **OSS Nvidia Driver PyTorch 2.7 (Ubuntu 22.04) 20260427**（东京 `ami-0152728adca68ed36` / us-east-1 `ami-012ba162b9cd2729c`，同名同发布日）；驱动 580.126.09 | `registry.yaml:340`、`registry.yaml:11294` |
| 网络 | 默认 VPC 公有子网，**安全组入站 0 条**，不挂 key pair，只走 SSM；IAM instance profile 给 SSM | `registry.yaml:335-339` |
| 磁盘 | gp3 200 GB · 4000 IOPS · 250 MB/s | `registry.yaml:341` |
| A10G 旧数据 | g5.4xlarge（A10G 23028 MiB）跑 IndexTTS 只比 L40S 慢 ~10%（自回归解码瓶颈非算力）；48 GB 的价值在"并行驻留更多服务" | `registry.yaml:192-197, 4294-4296` |

对 DeepSeek-OCR-2（3.39B，权重 6.31 GiB，`transformers==4.46.3 · torch 2.6 · flash-attn 2.7.3`，`docs/research/unlimited-ocr/RIVALS.md:54`）：单卡 24 GB 足够跑单路 ⇒ g5.xlarge(A10G 24G) / g6.xlarge(L4 24G) 是性价比候选【推断：仓内无 DeepSeek-OCR-2 在这两型上的实测】；g4dn(T4 16G) 无 bf16 原生加速、flash-attn 2 不支持 Turing（sm75）⇒ 不建议【推断】。按铁律 2，**先在目标机型实测峰值再定**。

### H.2 远端投放方式（SSM，不开 SSH）

- `bin/ssm-run <机器> <本地脚本> [--bg]`：脚本 base64 编码后投放、远端用 bash 执行（规避 SSM `AWS-RunShellScript` 的 shell→JSON→dash 三层转义与 bashism 问题）（`bin/ssm-run:2-14`）。`bin/ssm-put` 同法投文件（`bin/ssm-put:2`）。
- 长任务 `--bg`（内部 setsid），脚本自己写日志到 `/opt/gpu-stack/logs/<svc>/NNN.log`，**轮询日志末行 `VERDICT_AT_END: ...`**，不靠 SSM 返回值（`aws-gpu/CLAUDE.md:65-72`）。
- 要 root：`ROOT=1 bin/ssm-run ...`；运行期秘密 `--env K=V`（会进 SSM 命令历史，别传长期主凭证）。
- 本机代理坑：`SSL validation failed / UNEXPECTED_EOF` ⇒ 先看本机 Clash 代理，`no_proxy='*' NO_PROXY='*' ./bin/ssm-run ...`（`aws-gpu/README.md` 硬件节）。

### H.3 安装（remote/881）的结构 —— "预言写死 + 判据负对照"

`remote/881-uocr-install.sh:1-50`：
1. 文件头**跑前写死预言**（P1 版本、P2 离线安全检查、P3 首启 ≤600 s、P4 显存增量峰值 ≤ MEM_FRAC×46068+3000、P5 一页 ≤30 s 且召回 ≥0.90、P6 日志无 opt-in 告警、P7 恶意串被拒）。
2. 前置闸：驱动 ≥580、磁盘剩余 ≥ 下限，否则 `881_BLOCKED:<原因>`（`881:65-67`）。
3. wheel 大小 + sha256 校验（`881:72-76`）；锁文件 `uv pip compile --exclude-newer` + override 钉编译器三件套（`881:79-93`）；`uv pip sync`（`881:95-98`）。
4. 编译链离线探针：JIT 会在首个请求时以同样方式死掉 ⇒ 安装期就编一次（`881:133`）。
5. 权重 `snapshot_download(revision=REV, allow_patterns=...)` → `sha256sum` 落 `SHA256SUMS.gpu-stack` → 写 `REVISION.gpu-stack`（`881:234-244`）。
6. **判据负对照**（离线，先于起服务）：退化串 ⇒ J3/J4 红 · 空串 ⇒ J1/J2 红 · 真值本身 ⇒ 全绿；否则 `881_JUDGE_DEAD`（判据本身失活 ≠ 产物好）（`881:47-48`）。
7. 冒烟前 `bench_lock`（测量独占卡）+ 显存闸门；冒烟起的临时服务绑 127.0.0.1、跑完即停（`881:297-306`）。
8. 判定码枚举：`881_DONE / 881_INSTALLED_SMOKE_SKIPPED / 881_SMOKE_FAIL:<J…> / 881_SERVE_FAIL:<oom|died|timeout> / 881_BLOCKED / 881_JUDGE_DEAD / 881_FAIL`（`881:49-50`）。

### H.4 部署 + 验证（remote/884）—— verify 判据 = 产物

`remote/884-uocr-deploy.sh:1-60` 预言 D1–D12：
- D1 生产扁平路径 import 成功、openapi title 对、端点齐
- D2 ready ≤ 900 s
- D3 health fatal 项全 ok，且**期望值从投放的 schemas 现读**（原来手写"页窗口 10/10"副本 → 过期）
- D4 三端口只绑 127.0.0.1（`ss -ltn`）
- D5 冒烟：1 页召回 ≥0.85 · 3 页每页带自己的编号 · 空白页 `near_empty` · 并发 4 全部无坐标循环 · **复读截断真的触发**（用两页已知每轮都复读的样本；两页都没复读 ⇒ `D5_cut_unverified`，红：**没测到 ≠ 通过**）
- D6 安全：门面拒收 400 · 直打后端端口的恶意 pickle 非 200 且 marker 不存在
- D7 调度层 200 且 `served_by` 正确
- D8a 启动峰值 / D8b 稳态显存分开设线（曾把稳态线套在启动峰值上 ⇒ 假红）
- D11 长文档 60 页 stream：`completion_tokens > 39321`（旧隐藏封顶），没越过 ⇒ `D11_not_exercised`（红）
- D12 同步闸：`MAX_PAGES_SYNC+1` 页 ⇒ 413 且 `use=/api/ocr/stream`
- 判定：`884_PASS / 884_CHECK（功能全过但挤占同机服务）/ 884_INSTALLED_NOT_STARTED:<原因> / 884_FAIL:<D…> / 884_BLOCKED`

关键防呆：
- **机器身份核对**：IMDSv2 读本机 instance-id，与 `WANT_IID`（从 `lib/common.sh` 现取，不手写）不一致 ⇒ `884_BLOCKED:wrong_machine`（`884:74-77`）。
- **显存闸门**：空闲 < 闸门 ⇒ `884_INSTALLED_NOT_STARTED:vram_free_N`（幂等、如实报，不硬起）（`884:154-159`）。
- **红即回滚**：`on_exit` trap 停门面 + 后端（按需服务 ⇒ 回滚 = 停，不留半好的后端占 12 GB）（`884:164-170`）。
- 已在跑的生产重部署必须 `RESTART=1`，否则 `systemctl start` 是空操作、新代码不加载（`884:19-21`）。

### H.5 显存实测方法

- 铁律 2：`vram_mib` 必须来自实测 ⇒ verify 打印 `torch.cuda.max_memory_allocated()` → 回填 `vram_measured_peak_mib` → `vram_mib = 实测 × 1.25~1.30`（`aws-gpu/CLAUDE.md:10-12`；UOCR 10020×1.28≈12800，`registry.yaml:11210-11215`）。
- 整卡采样：后台 `while :; do nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; sleep 1; done > vram.trace`（`884:192`），起服务前读 `USED0`，增量峰值 = max − USED0（`884:154-155`）；进程视角 `nvidia-smi --query-compute-apps=pid,used_memory` 按 pid 求和（`884:414`）。
- **口径要写明**（`vram_measured_caliber`）：整卡增量含共卡噪声；启动峰值（profiling + 图捕获）与稳态分开（12617 vs 10123 MiB，`registry.yaml:11173`）。
- 预分配池（SGLang/vLLM 的 KV）让 nvidia-smi 看不出 KV 涨没涨 ⇒ 读引擎自己的日志（`benchmark/ocr-bench/longdoc.py:12-13`）。HF transformers 路径没有预分配池 ⇒ `torch.cuda.max_memory_allocated()` + `reset_peak_memory_stats()` 按请求量就够。
- **测量独占卡**：`source /opt/gpu-stack/bin/bench-guard.sh && bench_lock <名字>`（共卡让延迟涨 +78%~191% 且"长得跟正常数字一模一样"，`aws-gpu/CLAUDE.md:27-33`）。

### H.6 还原 / 回收

- 测试要停生产时的**三层还原**（`remote/891-ocr-longdoc.sh:41-43, 104-140`）：① `trap restore_prod`（正常/失败/TERM）② `systemd-run --unit=<guard> --on-active=<N>m` 兜底定时器：控制端失联时机器自己杀临时服务并起回生产 ③ 测前存档 `systemctl cat` 与 health，测后比对。测前生产不是 active ⇒ 不测（不知道该还原成什么样）。
- 变异/临时副本：白名单 + 体积闸 + `trap rm -rf`（§F.4，教训：临时脚本 `cp -r` 含 .venv/权重写满 969 GB 根盘）。
- AWS 资源：**不删除/终止任何实例、卷、快照**，除非用户逐个确认；新建资源打 tag `Project=gpu-stack, ManagedBy=claude-code`（`aws-gpu/CLAUDE.md:74-80`）。退役机实例保留（停机不计算力费）（`registry.yaml:205-215`）。

### H.7 DeepSeek-OCR 旧部署 `security_issue` 的教训

`registry.yaml:11250-11264`：旧 `deepseek-ocr`（l40s-48，systemd + conda，端口 5080）的 systemd unit **把 `DEEPSEEK_OCR_API_KEY` 明文硬编码在 `Environment=`** 里；排查过程中旧值已暴露。规定：恢复时必须改 `EnvironmentFile=/etc/gpu-stack/deepseek-ocr.env (chmod 600)` 并**轮换该 key**。

`docs/research/unlimited-ocr/RIVALS.md:66` 补充：**supersede 不等于关账** —— 即使不再恢复服务，仍须轮换 key（若还有效）并确认旧 unit 文件不在机器上残留明文；这条要单独跟踪，不能随条目 supersede 一起消失。

对本仓（已核）：仓库内 `deepseek-ocr.service` 当前**没有** key 字段；但它的 `WorkingDirectory=/home/neo/upload/DeepSeek-OCR` 与 registry 那台机器同路径 ⇒ 机器上的那份 unit 才是事故源。可移植的规则：
1. unit / compose / Dockerfile 里禁止出现 `*KEY*= / *TOKEN*= / *SECRET*=` 的字面值 ⇒ regression 用正则扫 `*.service docker-compose*.yml Dockerfile*` 钉住。
2. `systemctl show -p Environment <unit>` 对任何有读权限的本机用户可见 ⇒ 秘密只能走 `EnvironmentFile`（600）或 systemd credentials。
3. 发布前 `grep -rn "sk-\|ghp_\|ABSK" .`（Neo 全局规则）。

### H.8 DeepSeek-OCR-2 自身的已知弱项（写进 /capabilities 的素材）

- 拍照条件极弱：Real5-OmniDocBench Overall 73.01（Warping 66.5、Skew 61.3），全榜倒数段（`RIVALS.md:33, 54, 93-94`）。
- 手写：WildHandBench DeepSeek-OCR2 **9.46**（对照 PaddleOCR-VL-1.6 54.21）（`BENCH.md:156`）。
- 多语种：MDPBench DeepSeek-OCR 51.8（v1）（`BENCH.md:155`）。
- 单页 OmniDocBench v1.6 90.25（`RIVALS.md:54`）。
⇒ 照 UOCR `/api/capabilities` 的 `known_weak` 结构（`main.py:247-254`，每条带证据来源）写进本仓 API，"查不到的不声称支持"。

---

## I. 踩坑清单（现象 → 原因 → 修法）

| # | 现象 | 原因 | 修法 | 证据 |
|---|---|---|---|---|
| 1 | 23 页单页请求 finish=length，`穗长、` 逐字复读上千次，**零日志** | 客户端 `custom_params` 带了 `max_page_tokens` ⇒ 服务端 `page_guard_params` 返回 `{}` ⇒ 防复读 processor、每页上限、页守卫**三样全部静默关闭** | 不发该字段；regression 用**真函数**执行验证"服务端真的注入了"；J6 后验判据兜底 | `DIAG-883.md:38-56`，`lib/ocr/request.py:96-98`，`mutations.tsv:51-53` |
| 2 | processor 已注入但仍复读 | overlap 调度下 processor 看到落后一步的 output_ids ⇒ 禁错一位 | `SGLANG_ENABLE_DELAY_SAMPLE=1`，health 从 `/proc/<pid>/environ` 核 | `schemas.py:89-90`，`DIAG-883.md:289-317` |
| 3 | 复读页 finish=stop，J3 抓不到 | 页守卫强制 EOS | 新判据 J6（周期 + 数字归一模板 + 压缩比） | `judges.py:9-11`，`pages.py:89-90` |
| 4 | 100/200 页文档都在第 88 页之后全空 | `max_tokens = min(8000×页, 39321)` 的隐藏封顶，而服务端预算整本累计 | 删封顶，线性预算；用完给 `output_budget_exhausted` | `request.py:34-41`，`engine.py:261-264`，`longdoc-891…md` §2 |
| 5 | 坐标 `[23,268,268,268…` 循环、不报错 | 后端 eager 路径（CUDA graph 没开 / batch 形状落在桶外）坏产物 | decode/prefill 都 full graph、桶 = 并发；J4 判据；e2e "batch 中途缩小" 用例 | `schemas.py:96-105`，`test_http.py:140-150` |
| 6 | health 报 misconfigured / ready:false，而服务在正常出活 | 只读日志末 4 MiB 找启动标记，跑久被挤出窗口 | 按块倒读整份日志找本 pid 标记、偏移按 pid 缓存 | `backend.py:183-221`，`longdoc-891…md` §2 |
| 7 | 变异测试挂死 2582 s | 页号错一位 ⇒ 截断后从头重发同请求，无进展死循环 | G1 进展不变式 + 整请求墙钟 + 首行后空闲上限；pytest 套 `timeout` | `engine.py:217-219`，`DIAG-883.md:493-519`，`850:37-45` |
| 8 | 旧 `BACKEND_TIMEOUT_S=1800` 从不触发 | 名为"单请求上限"，实际传给 httpx 的是**每次读**超时，流不停就不触发 | 拆成名实一致的两个：`BACKEND_IDLE_S`（行间）+ `REQUEST_DEADLINE_S`（墙钟） | `DIAG-883.md:503` |
| 9 | 长文档同步请求 524 | Cloudflare ~100 s 无响应字节断开 | 同步端点页数上限 + stream 端点 15 s 心跳 + 栅格化移到开流后逐页做 | `schemas.py:48-50, 68-70`，`documents.py:7-10` |
| 10 | 一页复读拖死后面所有页 | 单请求内复读跑到上限 | 流式检测到即关连接、本页标截断、余页另起请求续做 | `engine.py:152-231` |
| 11 | 不 close 流 ⇒ GPU 白跑到 8000 token | 门面停止读 ≠ 后端停止生成 | `finally: stream.close()`；替身 `aborted` 计数证明连接真关了 | `engine.py:204-207`，`_fakes.py:31-32, 108-109` |
| 12 | 流里 `{"error":…}` 被当空输出，混进质量分 | SGLang 把引擎异常放进 SSE 而不是 HTTP 状态码 | `SseAccumulator.error` 单列，抛 `backend_stream_error`；OOM 再单列 | `request.py:113-143`，`engine.py:232-235` |
| 13 | 字段拼错被静默忽略 / 恶意 processor 字段看起来"没人提交" | FastAPI 解析后对象里没有未声明字段 | 依赖函数读**原始** form/query/JSON 键，未知 422、危险 400 | `main.py:124-148` |
| 14 | engine 产出的字段 API 响应里没了 | pydantic `response_model` 静默丢未声明字段 | `extra="allow"` 兜底 + 单测 OpenAPI 必须含字段名 | `schemas.py:6-8`，`test_http_contract.py:369` |
| 15 | `async def` 推理端点让整个服务卡死 | 阻塞推理跑在事件循环里 | 推理端点用同步 `def`（FastAPI 自动丢线程池）；AST 测试钉 | `test_defects.py:252-263`，`mutations.tsv:10` |
| 16 | PyMuPDF 并发崩 / 并发长请求排队 (k−1)×20 s | MuPDF 全局上下文非线程安全；整份先栅格化 | 全局锁只包单页；plan/rasterize 两段 | `documents.py:4-10, 22, 173-200` |
| 17 | 判"块内容字数"每块多 4 字 | 块类型词 `text` 留在内容里 | 先整段去块头再剥标签 | `judges.py:54-62` |
| 18 | e2e 页码比对找不到 "1111" | 两端对齐把数字排成 "1 1 1 1"，模型如实转写 | 比对前去空白（与召回口径一致） | `tests/e2e/test_http.py:57-61` |
| 19 | 固定 50 字线把真值 27 字的页判成空转写 | 场景子集真值很短 | 有真值时按比例 ≥0.3 判，无真值才退回 50 字；`j2_basis` 写明用哪条线 | `judges.py:5-6, 34-36, 154-160` |
| 20 | 测试用例尺寸差 1 字没到线 | 按原文字数算，而判据量的是数字归一后字数 | 用例尺寸按判据实际单位算 | `DIAG-883.md:486-491` |
| 21 | 变异"原样就红" / 变异被盖住假存活 | pyc 按 mtime(整秒)+大小判过期，等长变异同秒改坏又还原 | `PYTHONDONTWRITEBYTECODE=1` + `-p no:cacheprovider` | `850:14-16` |
| 22 | 变异脚本写满 969 GB 根盘、SSM 掉线、同机服务 500 约 30 min | 临时脚本 `cp -r` 整个项目（含 .venv/权重） | 白名单拷贝 + 体积/剩余空间闸 + trap 清理 | `850:8-11, 19-35` |
| 23 | 首个请求才 JIT 失败（ninja 找不到） | 进程 PATH 没带 venv/bin | 启动脚本显式 PATH、health 核 `PATH[0]`；安装期离线编译探针 | `backend.py:284-286`，`881:133` |
| 24 | 稳态显存线套在启动峰值上 ⇒ 假红 | 启动 profiling + 图捕获比稳态多 ~3.4 GB | 启动峰值/稳态分两条线 | `884:46-51` |
| 25 | 腾卡量的峰值在共卡下 OOM | 测量时独占卡，生产时有别的服务 | 显存闸门按"生产常态空闲"定；不够 ⇒ `INSTALLED_NOT_STARTED` 如实报 | `DIAG-883.md:521-529` |
| 26 | 生产重部署后新代码没加载 | `systemctl start` 对已在跑的 unit 是空操作 | `RESTART=1` 先停再起 | `884:19-21` |
| 27 | drain 文件没生效 | 按机器名建文件，调度层只按 id 读 | id 或名字都认 | `lib/dispatch/app.py:143-146` |
| 28 | 副本回 403 被原样透给调用方 | 转发了调用方的 `User-Agent: Python-urllib`，CF 边缘拦截 | 非 primary 的 401/403 视为可回落 | `lib/dispatch/policy.py:133-135` |
| 29 | `ssm-run` SSL EOF 时好时坏 | 本机代理条件导出，botocore 走了挂掉的代理 | `no_proxy='*'`；连续失败时看第二条不同的报错 | `aws-gpu/README.md` 硬件节 |
| 30 | systemd unit 明文 API key 泄漏 | `Environment=KEY=...` 对本机用户可读 | `EnvironmentFile`(600) + 轮换 + supersede 不关账 | `registry.yaml:11261-11264`，`RIVALS.md:66` |
| 31 | 上游 HF 模型代码对**模型生成的坐标串**做 `eval` | Unlimited-OCR #115：`extract_coordinates_and_label` 在 `save_results=True` 路径 eval | 用 `save_results=False`、自己落盘原始串；自写解析用正则提数 | `UPSTREAM.md:19, 74` |

#31 对本仓尤其相关：Unlimited-OCR 以 DeepSeek-OCR 为底座；本仓 vendored 的上游脚本里同样有 `eval(ref_text[2])`（`DeepSeek-OCR-master/DeepSeek-OCR-vllm/run_dpsk_ocr_pdf.py:143`、`run_dpsk_ocr_image.py:65, 254-289`）。本仓 `cuda_backend.py:73-87`（`:84` `save_results=False`） ✅，`web_service_unified.py:310` 用 `ast.literal_eval` ✅ —— 要用 regression 把这两点钉住（变异：改成 `save_results=True` / `eval(` 必须红）。DeepSeek-OCR-2 的 HF `modeling_*.py` 里是否同样有 eval【未核实：需 grep 本机 HF 缓存】。

---

## J. 给 DeepSeek-OCR-WebUI 的移植建议（P0 / P1 / P2）

> 原则：每条都配**可执行判据**（测试 + 变异），没判据的不算做完。顺序 = 安全 > 正确性可观测 > 体验/性能。

### P0（安全 / 假成功，先做）

| # | 改什么 | 怎么改（要点） | 判据 | 参照 |
|---|---|---|---|---|
| P0-1 | 🔴 前端 Markdown 预览 XSS | 方案 A（推荐，改动小）：`markdown-it` 输出过 `DOMPurify.sanitize(html, {USE_PROFILES: {html: true, mathMl: true, svg: false}})` 再 `v-html`；方案 B（UOCR 同款）：预览放 `<iframe sandbox="" :srcdoc="...">` + CSP meta `default-src 'none'; style-src 'unsafe-inline'`（KaTeX 需要再放 font-src） | vitest：喂 `<img src=x onerror=alert(1)>`、`<script>`、`<a href="javascript:">` ⇒ 渲染结果无 `onerror`/`script`/`javascript:`；变异：去掉 sanitize 必须红 | `UOCR/ui/index.html:208-209, 722`，SERVICE.md:63 |
| P0-2 | 🔴 默认绑 0.0.0.0 | `HOST = os.environ.get("HOST", "127.0.0.1")`；compose 映射 `"127.0.0.1:8001:8001"`；unit `--host 127.0.0.1`；对外走 cloudflared + Access | regression：AST/文本扫 `uvicorn.run` 默认 host、compose ports 前缀；e2e（Linux）读 `/proc/net/tcp` 只 `0100007F` | §G.1，`test_http.py:185-196` |
| P0-3 | CORS `allow_origins=["*"]` + `allow_credentials=True` | 改为 env 配置的 allowlist（默认同源/localhost dev 端口）；不需要 cookie 就关 credentials | 单测：未列入的 Origin 无 `access-control-allow-origin` | `web_service_unified.py:253-259` |
| P0-4 | 秘密不进 unit/compose | `EnvironmentFile=-/etc/deepseek-ocr-webui.env`；regression 正则扫 `*.service docker-compose*.yml Dockerfile*` 无 `(KEY|TOKEN|SECRET)=\S+`；`.gitignore` 含 `.env* *credentials* *secrets*` | 变异：往 unit 加 `Environment=API_KEY=x` 必须红 | §H.7 |
| P0-5 | 上游 `eval` 面 | 钉 `save_results=False`；坐标解析只用正则 `\d+` 提数（替代 `ast.literal_eval`，后者对超长/嵌套输入有 DoS 面） | regression：AST 扫 `backends/`、`web_service_unified.py` 无 `eval(`；`model.infer` 调用 `save_results` 恒 False | §I-31 |
| P0-6 | 错误响应四要素 + 不吞异常 | 引入 `InputError/BackendError(status, error, message, **extra)` + 4 个 exception_handler（含 RequestValidationError 改造）；现 `/ocr` 的 `except Exception: return {"success": False, "error": str(e)}, 500` 改为分类（OOM ⇒ 503 `backend_oom`，超时 ⇒ 504） | 单测：415/413/422/503/504 各一条，断言 `detail.error/message/actual/limit` 齐 | §A.4，`main.py:93-121`，`backend.py:64-72` |
| P0-7 | 上传闸门 | 文件头嗅探（不信扩展名/Content-Type）；`read(cap+1)` 判超限；图片解码前读头判像素（防解压炸弹，`PIL.Image.MAX_IMAGE_PIXELS` 同时设）；PDF `needs_pass`、0 页、每页像素上限；全部进 `Limits` 类并插进 Swagger description | 单测各一条 | §A.2、§B.1 |

### P1（产物可信 + 可观测）

| # | 改什么 | 要点 | 参照 |
|---|---|---|---|
| P1-1 | 每页产物判据 | 移植 `lib/ocr/judges.py` 的 `content_chars / repetition(J6) / zratio / coord_loop(J4) / char_recall`（纯函数、零依赖）；DeepSeek 的 `<|ref|>/<|det|>` 先剥再计数；响应加 `ok / pages[].failed / warnings[]`，**不过的页照样返回** | §C.1-C.2 |
| P1-2 | 复读截断 | HF `generate` 挂 `StoppingCriteria`：每 ~500 新字符解码尾部跑 `repetition()`，命中即停并标 `cut_by_repetition`；同时设单页 `max_new_tokens`；核实 HF 路径有无 no-repeat-ngram，没有就照上游 vLLM 参数（ngram 20 / window 50 / `<td>` 白名单）加 `LogitsProcessor` | §C.3，`run_dpsk_ocr_pdf.py:46` |
| P1-3 | health = 能出正确结果 | 启动后台线程：模型加载 → 用 PyMuPDF 现排一页已知中英文字（`china-s` 字体）走完整链路 → 召回 ≥0.85 且 Markdown 非空 ⇒ `ready=true`；`status ∈ ok/starting/error`；`checks[]` 里 `ok:null`=未验证；`warm{}`、`model_revision`、`torch/transformers` 版本、`inflight` 都报；Docker HEALTHCHECK 判 `ready` | §D.1-D.2，`engine.py:309-351` |
| P1-4 | request_id + loguru | `logger.remove()` + stderr + 文件轮转（`rotation="50 MB", retention=10, enqueue=True`）；每请求 `logger.bind(request_id=uuid4().hex[:12])`；响应体带 `request_id` 与分段 `timing`；替换 `print`；AST 测试禁 `import logging` | §A.6 |
| P1-5 | 长 PDF 流式 | 新增 `POST /api/ocr/stream`（NDJSON：`start → progress* → page* → done / error`）；输入校验在开流前（`first = next(gen)`）；15 s 心跳；整请求截止 `max(floor, per_page × 页数)`；页间 `await request.is_disconnected()` 停止后续页；同步端点设页数上限，超了 413 `too_many_pages_for_sync` 并指向 stream | §A.1、§B.4 |
| P1-6 | PDF 两段式 + 锁 | `plan()`（只读 rect）+ `rasterize()` 逐页 generator，`fitz` 全局锁只包单页；去掉 PNG→PIL→PNG 的二次编码 | §B.1 |
| P1-7 | 测试体系 | `FakeBackend.script(prompt, image)->str` 模拟复读串/坐标循环/空串/OOM/超时；TestClient 合同测试；regression 钉 DPI(144) / host / save_results / 无 eval；e2e 打真服务、不可达 skip、不 ready 则 fail；每个文件头 `TESTCOUNT` | §F |
| P1-8 | 变异验证 | `tests/mutations.tsv`（三列 + 上一行注释写缺陷）+ 本地 `scripts/mutate.sh`（临时副本、`PYTHONDONTWRITEBYTECODE=1`、`cmp -s` 判未落地、`timeout 300`、原样不绿先退出）；首批至少覆盖 P0/P1 每一条判据 | §F.4 |
| P1-9 | Swagger 即文档 | 每端点 `summary/description/response_model/responses`；description 用 f-string 插 `Limits`；`/api/capabilities` 写"能做/刻意不做/已知弱项（带证据）"（拍照/手写/多语种弱，§H.8）；单测钉"每端点有 summary+description""OpenAPI 含返回字段名" | §A.5 |

### P2（性能 / 运维 / 可复现）

| # | 改什么 | 要点 | 参照 |
|---|---|---|---|
| P2-1 | 模式透明化 | `mode=auto` 按页数/图尺寸选 base/gundam(crop_mode)，响应给 `mode_effective + mode_reason`；参数未校调前不开放 | `engine.py:27-34` |
| P2-2 | 权重与依赖可复现 | 钉 HF revision（不用 `master`）、`SHA256SUMS` + `REVISION` 标记文件；`uv` 锁文件 `--exclude-newer`；health 报 `hf_revision` | §G.5，`881:234-244` |
| P2-3 | 显存实测与闸门 | 每请求 `torch.cuda.reset_peak_memory_stats()` → `max_memory_allocated()` 进 timing/health；在目标机型（L4/A10G/L40S）实测后再定并发与页数上限，"闸门设在测过的点上" | §D.3、§H.5 |
| P2-4 | 并发模型 | 单卡保持 `Semaphore(1)`；加排队等待上限（超了 503 `queue_full` 四要素而非无限排）；`inflight`/队列进 health | §E |
| P2-5 | systemd 化（非 Docker 部署时） | 照 §G.2 表：`--workers 1 --no-access-log`、`EnvironmentFile`、`Restart=on-failure`、前置检查失败 `exit 78` + `RestartPreventExitStatus=78` | §G.2 |
| P2-6 | 对外暴露 | cloudflared → `127.0.0.1:8001` + Access（邮箱 + service token）；验收脚本对 `/ /docs /openapi.json /health /ocr` 未带凭证全部 302 | §G.3 |
| P2-7 | EC2 验证脚本 | 若要上 EC2：照 881/884 结构写一个 `remote/NNN-dsocr-verify.sh`（跑前写死预言、IMDSv2 核机器、显存闸、`bench_lock`、产物判据、`VERDICT_AT_END`、trap 回滚）；**不在本仓创建 AWS 资源** | §H |
| P2-8 | 清理 contract 动作 | 本仓根目录有多份历史入口/备份（`web_service.py / web_service_gpu.py / web_service_vllm_backup.py / ocr_ui_*backup*.html / fix_ui*.py / Dockerfile.v3.x`）⇒ 确认 `web_service_unified.py` 为唯一入口后移入档案或删除（避免"两份都可能被当权威"），并更新 `deepseek-ocr.service` 指向统一入口 | aws-gpu `context-budget` 原则 |

### 移植时**不要**照抄的东西

| UOCR 的东西 | 为什么不适用 |
|---|---|
| 300 DPI | Unlimited-OCR 上游值；DeepSeek-OCR 上游是 144 |
| 多页一次请求、`<PAGE>` 计数 J1、块格式 `<BLOCK>`、官方 `process_unlimitedOCR2.convert` | DeepSeek-OCR-2 是单图模型、输出是 Markdown + ref/det 标签 |
| SGLang 生效值核对（/proc environ、cuda graph、KV 池、#113 dill 补丁） | 本仓走 HF transformers 进程内推理；对应物是 torch/transformers/flash-attn 版本、dtype、attn_implementation、模型 revision |
| lib/dispatch 调度层 | 单机单卡时是预防性的（UOCR 自己也承认"一路时只多一跳"，SERVICE.md:178）；多实例时再考虑 |
| 判据阈值数字（1000 / 0.05 / 0.3 / 0.85） | 是在 Unlimited-OCR 输出上定标的；在 DeepSeek-OCR-2 输出上先跑一批干净页 + 已知复读页**重新定标**（UOCR 的方法：干净页一条都不许检出、复读侧最小值与线之间留缝），再写进 `Limits` 并注明来源 |
