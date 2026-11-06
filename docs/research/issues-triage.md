# DeepSeek-OCR-WebUI Issue 分诊报告

- 范围：neosun100/DeepSeek-OCR-WebUI issue #51 #50 #49 #47 #46 #45 #44 #42 #40 #39 #38 #36 #35 #32 #31 #30 #27 #23（共 18 条）
- 采集：2026-11-06，firecrawl `scrape`（markdown，onlyMainContent）；代码基线 `main@625b01c`（v4.1，DeepSeek-OCR-2）
- 另外用 firecrawl 抓了两份上游远程代码做对照：
  - `deepseek-ai/DeepSeek-OCR@1e3401a…/modeling_deepseekocr.py`（v3.x 钉的那个 "MPS support" revision）
  - `deepseek-ai/DeepSeek-OCR-2@main/modeling_deepseekocr2.py`（v4.x 现在用的版本）
- ⚠️ 截图看不到：#50 #47 #38 的正文只有截图（GitHub private-user-images 签名 URL，firecrawl 只拿得到链接），这几条的现象描述只能按标题和上下文推断，已标出。
- "可复现" 一列指 **Linux + NVIDIA GPU** 环境能不能复现、验证。

---

## 上游远程代码的关键事实（多条 issue 的根因都在这里）

| 版本 | `infer()` 里图像 dtype | autocast | 设备搬运 |
|---|---|---|---|
| DeepSeek-OCR @1e3401a（v3.x 钉住的 revision） | `fp32 if device.type=="mps" else bfloat16`（L819-821, L868-870） | `nullcontext() if mps else torch.autocast("cuda", bf16)`（L936, L956） | `.to(self.device)`（L940-942）；但 L522 `masked_scatter_(... .cuda())` 仍写死 |
| DeepSeek-OCR-2 @main（v4.x 现用） | **写死 `.to(torch.bfloat16)`**（L792, L805, L839） | **写死 `torch.autocast("cuda", bf16)`**（L906, L924） | **写死 `.cuda()`**（L909-911, L927-929, L942, L952, L963, L495） |

推论：
1. **模型在 CPU 上（fp32 权重）时**：输入被转成 bf16，而 `autocast("cuda")` 对 CPU 算子不起作用，所以 conv2d 报 `Input type (c10::BFloat16) and bias type (float) should be the same`。这正是 #30/#40 的报错原文，traceback 停在 `sam_model → patch_embed → proj → conv2d`。
2. **v4.x（OCR-2）的 MPS 和 CPU 后端全部失效**：远程代码写死了 `.cuda()`。`backends/mps_backend.py` 和 `backends/cpu_backend.py` 加载得起来，但只要推理就必然失败（Mac 上报 `Torch not compiled with CUDA enabled`）。v4.0 提交 deff59f 还删掉了 revision pin（"Removed hardcoded revision hashes"），连 v3.x 那条靠 1e3401a 撑着的 MPS 路径也没了。

---

## 逐条

### #51 Can we have a file size upload limit above 100mb?
- **状态**：open（2026-04-24，无评论）
- **现象**：上传 PDF 时被限制在 100MB 以内，用户希望放宽。没有给环境信息。
- **评论结论**：无。
- **疑似根因**：限制在前端写死，一共两处：
  - `frontend/src/services/add/index.ts:26`：`maxFileSize: 100 * 1024 * 1024 // 100MB for PDFs`（图片在 `:19` 限 10MB）
  - `frontend/src/services/pdf/index.ts:306-307`：`validatePDF` 里又写了一份 `const maxSize = 100 * 1024 * 1024`（**两份副本，改一处不够**）
  - 后端 `/ocr` 与 `/pdf-to-images` 本身没有大小上限（`web_service_unified.py:434`、`:542` 都是 `await file.read()` 全量读进内存）。
- **修复建议**：
  1. 两处常量合并成一个 `Limits`（放在 `config.ts`），可通过 `VITE_MAX_PDF_MB` 配置。
  2. 直接调大不安全：`pdf/index.ts:96-98` 先把整个文件转成 base64 字符串，再 `atob` 回 ArrayBuffer，`:189` 又复制一次；`pdfQueue.ts:466` 每渲染一页都 `source.data.slice(0)` 把整本 PDF 复制一份，再经 `postMessage` 结构化克隆（没有 transfer）送进 worker，worker 每页重新 `getDocument` 解析整本。200MB×N 页会把浏览器内存打爆。应该先改成 worker 常驻持有同一个 `PDFDocumentProxy`，或者用 transferable 只传一次，然后再放宽上限。
- **可复现**：✅ 纯前端问题，任何环境都能复现（上传一个 >100MB 的 PDF）。
- **优先级**：P2（功能诉求；但和 #50/#31 的内存问题耦合，要一起做）

### #50 display error in mutiple pages pdf file
- **状态**：open（2026-04-19，无评论）
- **现象**：PDF 页数多（大约 >50 页）时界面"显示错误"。正文只有一张截图，**报错原文不可读**。没有给环境信息。
- **评论结论**：无。
- **疑似根因**（推断，需要复现确认）：前端 PDF 管线的内存和存储随页数线性甚至超线性增长：
  - `frontend/src/services/pdf/pdfQueue.ts:466`：每页复制整本 PDF 的 ArrayBuffer，`:473-483` 再 postMessage（复制而不是 transfer）
  - `frontend/src/workers/pdfRender.worker.ts:161-170`：每页重新 `getDocument` 解析整本 PDF
  - `pdfQueue.ts:479`：`scale: 2.5` 加上 `imageFormat: 'png'`，A4 页约 1488×2105 PNG，单页 2-6MB，全部写进 IndexedDB（`:292 db.savePageImage`），另外还生成缩略图 dataURL
  - 50 页以上时容易撞上 IndexedDB 配额（Safari、无痕模式更低）或 tab 内存上限，表现为写库失败或页面渲染错误
- **修复建议**：
  1. 先拿到报错原文（请用户贴 DevTools Console），区分是 QuotaExceededError、OOM 还是 pdf.js 报错。
  2. worker 端缓存 `PDFDocumentProxy`（按 sourceId），不要每页重新解析、重新复制。
  3. 页面图改成 JPEG/WebP（quality 0.9），或者 scale 降到 2.0（OCR-2 的 base_size 是 1024，2.5 倍是浪费）。
  4. `db.savePageImage` 失败时把页面标成 error 并留痕，不要静默。
- **可复现**：✅ 纯前端，用 60-100 页的扫描 PDF 在 Chrome 上就能复现，与 GPU 无关。
- **优先级**：P1

### #49 导出md文件，会把ocr原始结果中的识别出的内容遗失掉
- **状态**：open（2026-04-13，作者自己追了 2 条评论并附上修复文件）
- **现象**：OCR 原始结果完整，但导出的 Markdown 丢内容。例子："## 1、年支空亡"下面 6 行全丢，"3、日支空亡"下的 ③④ 也丢了。丢的都是 `<|det|>` 里含**多个框**的块，例如 `[[157,183,535,220],[157,214,535,248],…]`。
- **评论结论**（作者用 qwen code 定位，附修改后的 markdown.ts）：
  1. `processBlockMatch` 解析坐标时，多框块按逗号拆出 8/24 个数，不等于 4，于是 `return null`，内容被静默丢弃。他新增了 `parseCoordinates()`，取第一个框。
  2. 第二个问题：`collectOverlappingBlocks` 做多栏聚合时窗口扩张过猛，会把下一节的正文拉进上一节的表格，下一节标题下面就空了。他加了 `hasHeadingInYRange`，禁止跨标题聚合。
- **代码定位**（已确认，和作者结论一致）：
  - `frontend/src/services/doc-gen/markdown.ts:90`：正则 `\[\[(.*?)\]\]` 对多框块捕获到的是 `157, 183, 535, 220], [157, 214, …`
  - `markdown.ts:138-140`：`coordsStr.split(',').map(Number)`，接着 `if (coords.length !== 4) return null`，**静默丢块**
  - **同样的 bug 还在** `frontend/src/services/doc-gen/ocr-parser.ts:41`、`:71-73`（`pdf.ts` 用它），所以 **PDF 导出也会丢**。作者只修了 markdown.ts。
  - `markdown.ts:340-362 collectOverlappingBlocks`：只跳过 heading 本身（`:348`），不阻止窗口越过 heading 继续扩张
- **修复建议**：
  1. 抽一个共享的 `parseDetBoxes(str): number[][]`（用 `JSON.parse('[[' + s + ']]')`），markdown.ts 和 ocr-parser.ts 都用它。多框取并集外接框（比只取第一个框更准，便于排序和聚合）。
  2. 解析失败时**不能丢内容**：退化成 `box: unknown` 的 text 块，并打 warn。
  3. 在 collectOverlappingBlocks 里加跨 heading 的边界判断，可以参考作者的 `hasHeadingInYRange`。
  4. 用 issue 里那段 raw_text 做 fixture，加进 `markdown.test.ts` 和 `ocr-parser.test.ts`，断言所有文字都在导出结果里。
- **可复现**：✅ 纯前端单元测试级别就能复现，不需要 GPU。
- **优先级**：**P1**（静默丢数据；根因明确，修复成本低）

### #47 切换页面一段时间后处理进程中止，返回后继续但有时当前处理页图片会失败
- **状态**：open（2026-02-04，只有截图，无评论）
- **现象**：浏览器切到别的标签页一段时间，处理就停了；切回来能继续，但当前那一页有时失败。截图不可读，没有给环境信息。
- **疑似根因**（推断）：
  1. **后台标签页节流/冻结**：Chrome 隐藏 5 分钟后对链式 `setTimeout` 做 intensive throttling（约 1 次/分钟），Memory Saver 还可能直接冻结或丢弃标签页。整条 OCR 管线由主线程的 setTimeout 驱动：
     - `services/ocr/index.ts:84-91`：`healthStore.isFull` 时 `delayWithSignal(5000)` 循环
     - `services/health/index.ts:56-59`：健康检查的链式 setTimeout；`stores/health.ts:35` 的 `setInterval(1000)`
     - 如果健康状态因为节流而过期（比如停在 `isFull`），队列会一直空转等待。
  2. **标签页被丢弃后重载**：
     - `clientId` 存在 sessionStorage（`services/clientId.ts:5`），重载后不变。服务端不检测客户端断开，旧的那次推理还在 executor 里跑，`MAX_CONCURRENT_PER_CLIENT=1`（`web_service_unified.py:39`）导致新请求连续 429。
     - `services/ocr/index.ts:229-233`：`resumeBatchOCR` 遇到 `recognizing`/`pending_ocr` 但 **IDB 里没有图片**的页直接跳过，不报错，页面就一直卡着。
     - `services/pdf/pdfQueue.ts:739-742`：`rendering` 状态被重置为 pending 重新渲染；worker 里渲染到一半的那页结果丢失，再加上 `:466` 的大块复制，在内存紧张时更容易失败，这就是"当前处理页图片会失败"的来源。
- **修复建议**：
  1. 监听 `visibilitychange`：切回前台时立即做一次健康检查并"踢"一下队列；对需要长跑的场景，可以用 Web Lock 或 `navigator.locks` 降低被丢弃的概率。
  2. resumeBatchOCR 对没有图片的页标成 `pending_render` 或 error，并留痕。
  3. 服务端在推理前后检查 `await request.is_disconnected()`，客户端断开时尽早释放 client 配额（推理中途无法中断，至少排队阶段可以放弃）。
- **可复现**：✅ 和 GPU 无关；Chrome 上开 30 页 PDF，切走 6 分钟以上即可观察。用 `chrome://discards` 手动丢弃标签页可以复现重载路径。
- **优先级**：P2

### #46 NVIDIA Driver Release 580.82?
- **状态**：open（2026-01-30，无评论）
- **现象**（原文）：
  ```
  ERROR: This container was built for NVIDIA Driver Release 580.82 or later, but
  version 550.144.03 was detected and compatibility mode is UNAVAILABLE.
  [[Forward compatibility was attempted on non supported HW (CUDA_ERROR_COMPAT_NOT_SUPPORTED_ON_DEVICE) cuInit()=804]]
  ```
  环境：宿主机驱动 550.144.03，GPU 型号未给出（"non supported HW" 说明是消费级卡，不支持 forward compat）。
- **评论结论**：无。
- **疑似根因**：
  - 所有 Dockerfile 都基于 `nvcr.io/nvidia/pytorch:25.09-py3`（CUDA 13.0，要求驱动 ≥580）：`Dockerfile:7`、`Dockerfile.v3.6:11`、`Dockerfile.v4.0:5`、`Dockerfile.gpu:1`、`Dockerfile.allinone:4`。
  - 更严重的是：容器不会因此退出。`torch.cuda.is_available()` 返回 False 后，`web_service_unified.py:176-187 detect_platform()` **静默回退到 CPU**（只打一行 `⚠️ No GPU detected`），CPU 路径又必然失败（见 #40）。**#46 是 #30/#40 的上游诱因之一。**
- **修复建议**：
  1. 基础镜像降到 CUDA 12.x，比如 `nvcr.io/nvidia/pytorch:24.0x-py3`（CUDA 12.4/12.6，驱动 ≥550 即可），或者 `pytorch/pytorch:2.x-cuda12.4-cudnn9-runtime` 再加装 flash-attn。也可以同时发 `-cu124` 和 `-cu130` 两个 tag。
  2. README/DOCKER_HUB 写清驱动最低版本。
  3. `detect_platform()`：用户传了 `--gpus`（即 `NVIDIA_VISIBLE_DEVICES` 已设置）但 CUDA 不可用时 **fail fast**，报出驱动版本和要求版本，不要静默降级到 CPU（符合"降级必须留痕"）。
- **可复现**：✅ 在驱动 <580 的 Linux + 消费级 NVIDIA 卡上 `docker run --gpus all neosun/deepseek-ocr:latest` 即可复现；也可以在 580+ 的机器上用 25.09 镜像对照。
- **优先级**：**P0**（主力部署方式在主流 550/570 驱动上直接不可用，并连锁引出 #30/#40）

### #45 使用限制GPU吗?
- **状态**：open（2026-01-29，无评论）
- **现象**：问已经下载好的镜像能不能只用 CPU 跑 docker、参数是什么。
- **疑似根因**：
  - 文档声称可以：`DOCKER_HUB.md:60-66` 给出了"仅 CPU"的 `docker run`（不带 `--gpus`）。代码也支持 `FORCE_BACKEND=cpu`（`web_service_unified.py:160-163`）。
  - **但 CPU 路径实际不可用**：`backends/cpu_backend.py:126-132` 用 fp32 加载，v3.x 的远程代码会把输入转成 bf16，于是报 #40 的错；v4.x 的远程代码写死 `.cuda()`，在无 GPU 的机器上直接失败。
  - `docker-compose.yml:10-15` 写死了 GPU reservation。
- **修复建议**：
  1. 短期：在文档里删掉或标注 CPU 模式"当前不可用"，回复用户。
  2. 中期：给 CPU/MPS 写一层 patch，加载后 monkeypatch 远程 `infer`（把 `.cuda()` 换成 `.to(self.device)`、bf16 换成模型 dtype、autocast 换成 nullcontext），或者 vendor 一份设备无关的 `modeling_deepseekocr2.py`。
  3. CPU 推理每页需要数分钟，要给出预期。
- **可复现**：✅ 在 GPU 机器上 `-e CUDA_VISIBLE_DEVICES=""` 或 `-e FORCE_BACKEND=cpu` 就能复现 CPU 路径失败。
- **优先级**：P1（文档与实现不符；和 #40 是同一个根因）

### #44 DeepSeekOCRV2版本支持计划
- **状态**：open（2026-01-28；2026-02-17 有一条"同问"，各 1 个 👍）
- **现象**：询问是否会适配 DeepSeek-OCR-2。
- **结论**：**已实现**：`deff59f`（2026-02-20，v4.0）切换到 `deepseek-ai/DeepSeek-OCR-2`；`5c901d8` v4.1 在 `/health` 返回 `model_version`（`web_service_unified.py:369`）。issue 没有关闭。
- **修复建议**：回复 v4.0/v4.1 的镜像 tag 和变更说明后关闭。顺带说明 v4.x 目前仅支持 CUDA（见 #39/#45）。
- **可复现**：N/A（功能已交付；可以在 Linux GPU 上验证 v4.1 镜像能跑通 OCR-2）
- **优先级**：P2（只需回复并关闭）

### #42 [macOS Apple Silicon] Startup fails without PyTorch and Accelerate, and requires manual frontend build
- **状态**：open（2026-01-24，作者 niccoreyes，无其他评论）
- **现象**（三段）：
  1. `ModuleNotFoundError: No module named 'torch'`（`backends/mps_backend.py:4 import torch`）
  2. 装好 torch 后：`ImportError: Using low_cpu_mem_usage=True or a device_map requires Accelerate: pip install 'accelerate>=0.26.0'`
  3. 模型下载完成后访问 `http://localhost:8001` 没有 WebUI，需要手动 `cd frontend && npm i && npm run build`
  - 环境：macOS Apple Silicon，conda env 名为 `deepseek-ocr`（不是脚本期望的 `deepseek-ocr-mlx`），Python 3.11
- **评论结论**：用户自己的解决办法是 `conda install pytorch torchvision torchaudio -c pytorch-nightly`、`pip install "accelerate>=0.26.0"`，再手动构建前端。
- **疑似根因**：
  - `requirements-mac.txt:5-7`：torch 被注释掉（"install separately first"），**而且没有 accelerate**。`requirements.txt:3` 里有 accelerate，Mac 那份漏了。
  - `backends/mps_backend.py:197`：`low_cpu_mem_usage=True` 依赖 accelerate
  - `verify_mac_env.sh:28-29` 检查了 torch，但没检查 accelerate
  - `.gitignore:9` 忽略了 `dist/`，clone 下来没有前端产物；`start.sh` 不构建前端；`web_service_unified.py:337-338` 只返回一行 `Frontend dist not found.`，没给构建指引
  - `start.sh:40` 硬编码 env 名 `deepseek-ocr-mlx`
- **修复建议**：
  1. requirements-mac.txt 加上 `accelerate>=0.26.0` 和 `torch>=2.1`（PyPI 上的 macOS arm64 wheel 自带 MPS，不需要 nightly）。
  2. verify_mac_env.sh 检查 accelerate，并检查 `frontend/dist/index.html` 是否存在。
  3. start.sh 在 dist 不存在时自动 `npm ci && npm run build`，或者给出明确提示；root 的 HTML 提示里写出构建命令。
  4. **注意：就算这三步都修好，v4.x 的 MPS 推理仍然会因为 `.cuda()` 失败（见 #39）**。
- **可复现**：⚠️ 依赖缺失和前端 dist 缺失可以在 Linux 上复现（fresh clone、不构建前端），MPS 部分不能。
- **优先级**：P1

### #40 OCR失败，会出现RuntimeError: Input type (c10::BFloat16) and bias type (float) should be the same，已经用了最新的docker版本
- **状态**：open（2026-01-17；2026-02-12 有用户追问"只用cpu计算就会有这个错误？"）
- **现象**（报错原文关键行）：
  ```
  File ".../DeepSeek-OCR/1e3401a3d4603e9e71ea0ec850bfead602191ec4/modeling_deepseekocr.py", line 423, in forward
      local_features_1 = sam_model(patches)
  File ".../deepencoder.py", line 699, in forward   x = self.patch_embed(x)
  File ".../deepencoder.py", line 999, in forward   x = self.proj(x)
  File "/usr/local/lib/python3.12/dist-packages/torch/nn/modules/conv.py", line 543, in _conv_forward
  RuntimeError: Input type (c10::BFloat16) and bias type (float) should be the same
  ```
  环境：最新 docker 镜像（v3.x，Python 3.12 即 nvcr 25.09），GPU/驱动未给出。
- **评论结论**：评论者推测"只用 CPU 计算就会有这个错误"，这个推测**是对的**。
- **疑似根因**（已用上游源码确认）：
  - 报错里的 `bias type (float)` 说明权重是 **fp32**，只有 CPU 或 MPS 后端会用 fp32 加载。CUDA 后端是 bf16/fp16，而且在 CUDA autocast 下 conv 会自动统一 dtype，不会报这个错。
  - 1e3401a 远程代码：`image_dtype = fp32 if device.type=="mps" else bfloat16`（上游 L820），所以 **CPU 设备上输入是 bf16**；`autocast("cuda")`（L936）对 CPU 算子无效，于是 conv2d dtype 不一致。
  - 为什么"有 GPU 却跑在 CPU 上"：nvcr 25.09 要求驱动 ≥580（见 #46）。驱动更旧时 `torch.cuda.is_available()==False`，`web_service_unified.py:185-187` 静默回退到 CPU，`backends/cpu_backend.py:130` 用 fp32 加载。
- **修复建议**：
  1. 修 #46（基础镜像和驱动），并让 detect_platform 在用户期望 GPU 时 fail fast。
  2. CPU 后端：短期把 CPU 标为不支持并给出明确报错；中期用 monkeypatch 或 vendor 一份设备无关的 infer（见 #45）。
  3. 启动日志打印 `backend / dtype / torch.version.cuda / 驱动版本`，`/health` 也返回这些字段，便于用户贴日志。
- **可复现**：✅ v3.x 镜像加 `-e CUDA_VISIBLE_DEVICES=""` 可以稳定复现同一个报错；或者在驱动 550 的机器上跑 nvcr 25.09 镜像。
- **优先级**：**P0**

### #39 OCR 失败：OCR API Error: 500 Internal Server Error
- **状态**：open（2026-01-17；2026-01-24 niccoreyes 评论）
- **现象**（原文）：
  ```
  File ".../backends/mps_backend.py", line 47, in infer   result = self.model.infer(
  File ".../transformers_modules/DeepSeek-OCR-Model/modeling_deepseekocr.py", line 935, in infer
      input_ids.unsqueeze(0).cuda(),
  AssertionError: Torch not compiled with CUDA enabled
  INFO: 127.0.0.1 - "POST /ocr HTTP/1.1" 500 Internal Server Error
  ```
  环境：macOS 26.2，M5，32GB，conda `deepseek-ocr-mlx`，torch 2.9.1、transformers 4.46.3；**`LOCAL_MODEL_PATH` 指向手动下载的 DeepSeek-OCR 模型**。
- **评论结论**：niccoreyes 说 `export PYTORCH_ENABLE_MPS_FALLBACK=1` 后再 `./start.sh` 就可以了。⚠️ 这个变量只能让 MPS 上不支持的算子回退 CPU，**解决不了 `.cuda()` 写死的问题**。他能成功，更可能是因为没设 LOCAL_MODEL_PATH，走的是钉住 1e3401a 的 HF 下载。
- **疑似根因**：
  - v3.x：`mps_backend.py` 钉了 `revision=1e3401a…`（MPS 补丁版），但 **LOCAL_MODEL_PATH 是本地目录时 revision 不生效**，用户下载的是 main 分支的远程代码，里面还是 `.cuda()`。
  - v4.x 现状更糟：`backends/mps_backend.py:192-199` 加载 OCR-2，而 OCR-2 远程代码 L909-911 等处写死 `.cuda()`，**所有 Mac 用户推理必然 500**。
  - 前端只显示"500 Internal Server Error"：`frontend/src/services/ocr/providers.ts:95-99` 在 `!response.ok` 时直接 `throw new Error('OCR API Error: ' + status)`，**丢掉了后端返回的 `{"error": "..."}` 正文**（`web_service_unified.py:485`），用户在 UI 上看不到真正的原因。
- **修复建议**：
  1. MPS 和 CPU 用 vendor 或 monkeypatch 得到设备无关的 infer（同 #45）；或者 v4.x 明确声明 Mac 不支持、继续用 v3.x 加 1e3401a。
  2. LOCAL_MODEL_PATH 模式下校验远程代码里是否有 `.cuda()`，有就启动时报错并给出指引。
  3. providers.ts 在非 2xx 时读取 `await response.json().catch(()=>null)?.error` 并拼进错误消息。
- **可复现**：⚠️ MPS 部分不能在 Linux 上复现；但 "前端吞掉 500 正文" 和 "OCR-2 远程代码写死 cuda" 都能在 Linux 上验证（`FORCE_BACKEND=cpu` 同样会因 `.cuda()` 或设备不匹配失败）。
- **优先级**：P1（对 Mac 用户是 P0；产品若宣称支持 Mac，应该升为 P0）

### #38 最新3.5版，Windows11环境，docker desktop无论如何也拉取不下来，图形界面和命令行都是。
- **状态**：open（2026-01-17，只有 2 张截图，无评论）
- **现象**：Windows 11 + Docker Desktop，GUI 和 CLI 都拉不下 v3.5 镜像。截图不可读，报错原文未知。
- **疑似根因**（推断）：
  - 镜像体积大：nvcr pytorch 25.09 基础层约 10GB+，`Dockerfile.v3.6:39-42` 和 `Dockerfile.v4.0:32-35` 还把模型（约 6.7GB）打进了镜像，单层很大。Docker Desktop 的 WSL2 虚拟盘空间不足，或者大层下载中断后反复重试，都会表现为"怎么也拉不下来"。
  - 用户网络环境未知（中文用户，可能有 Docker Hub 访问问题），**不能默认是网络封锁**，要先看截图里的报错。
  - Windows Docker Desktop 下 GPU 路径本身也有问题（#30 里 cloudman6 在 Windows Docker 上报 bf16 错误，换到 Linux 原生后正常）。
- **修复建议**：
  1. 请用户贴 `docker pull` 的文字输出和 `docker system df`。
  2. 提供不含模型的 slim 镜像，模型用 volume 挂载（`HF_HOME=/app/models`，`Dockerfile.v4.0:14-15` 已经预留了这个路径）。
  3. 同步推一份镜像到 GHCR 或其他 registry 做备选。
- **可复现**：⚠️ Windows 专属，不能在 Linux 上复现；镜像体积可以在 Linux 上量（`docker image inspect`）。
- **优先级**：P2

### #36 MACOS 26.2 M5芯片，32G内存 安装失败
- **状态**：open（2026-01-15；2026-01-24 niccoreyes 评论，内容等同 #42）
- **现象**：
  1. `./start.sh` 停在 `✅ Using conda environment: deepseek-ocr-mlx` 不动，没有日志，内存占用 13-15GB，开关代理都一样。
  2. 手动 `python web_service_unified.py` 能加载模型，第一次推理打印 `BASE: [1,256,1280] PATCHES: [6,100,1280]` 后长时间无响应，**内存溢出**（截图）。
  3. 设了 `LOCAL_MODEL_PATH` 后报 `Torch not compiled with CUDA enabled`，与 #39 相同。
  4. 用户自己改代码时写错了：`os.environ.get("/Volumes/MacD/...", "")`，把路径当成了环境变量名。
  - 环境：macOS 26.2，M5，32GB，torch 2.9.1，transformers 4.46.3
- **评论结论**：niccoreyes 指向 #42（装 torch、accelerate，构建前端）。
- **疑似根因**：
  - "卡住没日志"：`start.sh:42` 用的是 `conda run -n deepseek-ocr-mlx python web_service_unified.py`，**`conda run` 默认捕获并缓冲 stdout**（没加 `--no-capture-output`/`--live-stream`），模型下载和加载进度全被吞掉，看起来像卡死。
  - 内存溢出：`backends/mps_backend.py:196` 用 fp32 加载（约 3B 参数，权重约 12GB），`crop_mode=True` 时 6 个 patch 的激活也是 fp32。MPS 与 CPU 共享 32GB 统一内存，生成 8192 token（上游 `max_new_tokens=8192`）时 KV cache 继续增长。
  - `.cuda()`：同 #39。
- **修复建议**：
  1. `start.sh` 改成 `conda run --no-capture-output -n …`，或者 `PYTHONUNBUFFERED=1` 加 `exec`。
  2. MPS 改用 fp16 加载（torch ≥2.3 的 MPS 已支持大部分 fp16 算子），设 `PYTORCH_MPS_HIGH_WATERMARK_RATIO`，并允许配置 `crop_mode=False` 和更小的 max_new_tokens。
  3. 根治同 #39。
- **可复现**：⚠️ `conda run` 吞日志可以在 Linux 上复现；MPS 内存问题不能。
- **优先级**：P1

### #35 盼着支持MAC M5芯片
- **状态**：open（2026-01-15，无评论）
- **现象**：M5、32GB 上内存溢出。没有日志（同一用户 #36 里有详细日志）。
- **疑似根因**：同 #36（fp32 + crop_mode + 8192 token），v4.x 下还有 `.cuda()` 写死的问题。
- **修复建议**：与 #36/#39 合并跟踪，关掉 #35 作为重复。
- **可复现**：❌ Mac 专属
- **优先级**：P2（合并到 #36）

### #32 多卡部署
- **状态**：open（2025-12-25，无评论）
- **现象**：问是否支持多卡部署、给 N 个人同时用。
- **疑似根因 / 现状**（代码层面不支持）：
  - `Dockerfile.v4.0:11` 和 `Dockerfile.v3.6` 的 ENV 写死 `CUDA_VISIBLE_DEVICES=0`
  - `backends/cuda_backend.py:64` 用 `.to("cuda")`，即 cuda:0，单实例单模型
  - `web_service_unified.py:45`：`ocr_executor = ThreadPoolExecutor(max_workers=1)`；`:231`：`ocr_semaphore = asyncio.Semaphore(1)`。全局串行。
  - `:40`：`MAX_CONCURRENT_PER_IP = 4`，同一个 NAT 后面的多人会互相限流；`:70-72` 无条件信任 `X-Forwarded-For`，客户端可以伪造来绕过 per-IP 限制
- **修复建议**：
  1. 最简单的办法（不改代码）：每张卡起一个容器（`--gpus '"device=N"'`，同时覆盖 `-e CUDA_VISIBLE_DEVICES=0`），前面放 nginx/Traefik 做 least_conn 负载均衡。写进文档。
  2. 进阶：后端维护 N 个 `CUDABackend(device=f"cuda:{i}")`，executor 的 max_workers 设为 N，semaphore 设为 N。注意远程代码写死的 `.cuda()` 指向的是当前设备，需要在每个 worker 线程里 `torch.cuda.set_device(i)`。
  3. 或者改走 vLLM 后端（上游 `DeepSeek-OCR-vllm` 已有），用 tensor 或 data parallel 提吞吐。
  4. per-IP 限额做成可配置；`X-Forwarded-For` 只在配置了 trusted proxy 时才采信。
- **可复现**：✅ 多卡 Linux 机器上可以验证。
- **优先级**：P2（功能诉求；第 1 条文档化成本很低）

### #31 在转换大PDF时，整个Docker会卡死，无法定位问题
- **状态**：open（2025-12-16，无评论）
- **现象**：A100 40G，`docker run --gpus all --shm-size=16g neosun/deepseek-ocr:latest`。上传一本书的 PDF 后，前端停在 "PDF Conversion Start"，Docker 日志没有任何输出，前端无响应，**重开页面也无响应**。用户建议分离进程、增加后台日志。
- **评论结论**：无。
- **疑似根因**：
  - 当时（v3.3，2025-12）镜像跑的是旧 UI `ocr_ui_modern.html:2428/3366`，调用 `/pdf-to-images`。旧版 `web_service_gpu.py:286-339` 在 `async def` 里**同步**执行 fitz 全书渲染、PNG `optimize=True` 压缩和 base64 编码，**阻塞了整个事件循环**，所以 `/health` 和新页面也无响应，而且逐页没有日志。
  - 当前 `web_service_unified.py:522-572` 已经改成 `run_in_executor`（`:548-554`），不再阻塞事件循环。但 `_render_pdf_pages`（`:493-519`）仍然把**所有页的 base64 PNG 拼成一个 JSON 一次返回**：500 页 × 约 1-3MB ≈ 1GB 以上的 JSON，服务端和浏览器都会内存暴涨；逐页也没有日志。
  - Vue 前端（v3.5+）已经改为浏览器端用 pdf.js 渲染，不再调用 `/pdf-to-images`，但前端也有 #50/#51 的内存问题。
- **修复建议**：
  1. `/pdf-to-images` 改成分页接口（`?page=N` 或 `start/end`），或者流式 NDJSON；不要用 `optimize=True`（太慢），改 JPEG。
  2. 渲染循环里每 N 页打一行日志（页号、耗时）。
  3. 加上页数和文件大小上限，按错误四要素返回。
  4. 如果旧 UI 和旧端点已经不维护，在文档里标记弃用，并在 issue 里说明 v3.5+ 前端已改为客户端渲染。
- **可复现**：✅ Linux GPU 上用 v3.3 镜像加一本 300 页以上的 PDF 能复现卡死；当前版本直接 `curl -F file=@book.pdf /pdf-to-images` 可以观测内存峰值。
- **优先级**：P1

### #30 Input type and bias type should be the same error (Linux + nvidia)
- **状态**：**closed**（2025-12-15 由 e4c8fb5 关闭）
- **现象**：Ubuntu + NVIDIA，`docker run --runtime=nvidia --gpus all -e CUDA_VISIBLE_DEVICES=0 --shm-size=8g neosun/deepseek-ocr:latest`，报错 `Input type (c10::BFloat16) and bias type (float) should be the same`，处理 4.3 秒。cloudman6 在 Windows Docker Desktop 上遇到同样的错（"换了多张 image 都报错，完全无法使用"）。
- **评论结论**：
  - Owner：模型以 bf16 加载，但某些层的 bias 是 fp32。修复 e4c8fb5：按 compute capability 选 dtype，<8.0 用 fp16。
  - cloudman6（12-16）："切换到 Linux Native，同一块 4070，没有问题，可能跟 docker image 有关，或者是 windows"。
- **代码定位**：**这个修复没有命中根因**。
  - RTX 4070 是 sm_89，修复前后都会走 bf16 分支，e4c8fb5（`backends/cuda_backend.py:18-29`）对它没有任何影响。
  - 报错是 `bias type (float)`，即 fp32 权重，说明模型被加载在 **CPU**（`cpu_backend.py:130`）上，原因是 docker 内 CUDA 不可用（驱动 <580，见 #46），被 `web_service_unified.py:185-187` 静默回退到 CPU。cloudman6 在原生 Linux 上正常，正好印证"问题出在镜像，不在代码 dtype"。
  - 如果真有 fp16 权重配 bf16 输入的情况，报错应该是 `bias type (c10::Half)`，也对不上。
- **修复建议**：**重新打开**，与 #40/#46 合并。修复方案见 #46 和 #40。
- **可复现**：✅ 同 #40。
- **优先级**：**P0**（被误关；#40 就是复发）

### #27 attention_mask
- **状态**：**closed**（2025-12-05）
- **现象**：`The attention mask and the pad token id were not set… Setting pad_token_id to eos_token_id:None for open-end generation.`
- **评论结论**：Owner 称已在 generate 里显式传 `pad_token_id=eos_token_id` 修复（FIXES.md:30-50，改的是 `backends/transformers_backend.py`）。
- **代码定位**：
  - 当前 `backends/transformers_backend.py` 里**没有 `pad_token_id`**（grep 为空）；只有 `web_service.py:168-171` 有。修复没有保留下来，或者只存在于不再使用的入口。
  - 实际在用的 `web_service_unified.py` 走 `cuda/mps/cpu_backend.infer()`，调用的是上游远程 `model.infer()`，里面的 generate（OCR-2 上游 L906-920）只传了 `eos_token_id`，没有 attention_mask，**所以这个警告在 v4.x 仍会出现**（#36 的日志里 2026-01 还能看到）。
  - 只是警告，batch=1、无 padding 时不影响结果。
- **修复建议**：在 load_model 后设置 `self.model.generation_config.pad_token_id = tokenizer.eos_token_id`（或 config），一行就能消除。同时更正 FIXES.md 的口径。
- **可复现**：✅ 任意一次 OCR 都能在日志里看到。
- **优先级**：P2

### #23 报错：You are using a model of type deepseek_vl_v2 to instantiate a model of type DeepseekOCR.
- **状态**：**closed**（2025-12-16）
- **现象**：加载时有一串 `A new version of the following files was downloaded… Make sure to double-check they do not contain any added malicious code… you can pin a revision`，以及 `You are using a model of type deepseek_vl_v2 to instantiate a model of type DeepseekOCR`。
- **评论结论**：Owner 认为这是 transformers 的兼容性警告，可以忽略；后两条评论讲的是 bf16/fp16 的修复（和本 issue 无关）。
- **代码定位**：
  - model_type 警告确实无害（上游 config 设计如此）。
  - 但 "new version downloaded / pin a revision" 是**供应链风险提示**：v4.0 的 deff59f 明确 "Removed hardcoded revision hashes"，`backends/*_backend.py` 和 `Dockerfile.v4.0:32-35` 都是 `trust_remote_code=True` 且不钉 revision。上游仓库一更新远程代码，就会**在用户机器上执行未审查的新代码**，行为也会漂移。这类漂移正好是 #39（main 与 1e3401a 行为不同）的成因之一。
- **修复建议**：OCR-2 钉一个具体 commit hash（backend 和 Dockerfile 预下载处用同一个常量），镜像构建时预下载，运行时设 `HF_HUB_OFFLINE=1`。
- **可复现**：✅
- **优先级**：P2（安全加固）

---

## 汇总表

| # | 标题（简） | 状态 | 根因归类 | 主要位置 | Linux+NVIDIA 可复现 | 优先级 |
|---|---|---|---|---|---|---|
| 51 | 上传上限 >100MB | open | 前端硬编码上限（2 份副本）+ 全量复制 | `add/index.ts:26`、`pdf/index.ts:307` | ✅ | P2 |
| 50 | 多页 PDF（>50）显示错误 | open | 前端 PDF 管线内存/IDB 线性膨胀（推断） | `pdfQueue.ts:466,479`、`pdfRender.worker.ts:161` | ✅ | P1 |
| 49 | 导出 MD 丢内容 | open | 多框 `<\|det\|>` 解析失败后静默丢块；跨标题聚合 | `markdown.ts:138-140,340-362`、`ocr-parser.ts:71-73` | ✅ | **P1** |
| 47 | 切后台后中止、回来当前页失败 | open | 后台节流/丢弃 + resume 静默跳过 + 服务端不感知断开 | `ocr/index.ts:84-91,229-233`、`clientId.ts:5` | ✅ | P2 |
| 46 | 驱动要求 580.82 | open | 基础镜像 CUDA 13 要求驱动 ≥580；静默降级到 CPU | 全部 `Dockerfile*` FROM 25.09；`web_service_unified.py:185-187` | ✅ | **P0** |
| 45 | 能否 CPU 跑 docker | open | 文档宣称支持，CPU 路径实际坏掉 | `DOCKER_HUB.md:60-66`、`cpu_backend.py:126-132` | ✅ | P1 |
| 44 | OCR-2 支持计划 | open | 已在 v4.0 交付，未关闭 | `deff59f` | N/A | P2 |
| 42 | Mac 缺 torch/accelerate、需手动构建前端 | open | requirements-mac 缺依赖；dist 不入库且无构建步骤 | `requirements-mac.txt`、`start.sh`、`web_service_unified.py:337` | ⚠️ 部分 | P1 |
| 40 | BFloat16 vs float（最新 docker） | open | CPU 回退 + 远程代码 bf16 输入 | `cpu_backend.py:130`、上游 L820/L936 | ✅ | **P0** |
| 39 | 500（Mac，`.cuda()`） | open | 远程代码写死 `.cuda()`；LOCAL_MODEL_PATH 绕过 revision；前端吞掉错误正文 | `mps_backend.py:192`、`providers.ts:95-99` | ⚠️ 部分 | P1 |
| 38 | Windows 拉不下镜像 | open | 镜像过大/单层过大（推断） | `Dockerfile.v3.6:39`、`Dockerfile.v4.0:32` | ❌ | P2 |
| 36 | M5 安装失败、卡住、OOM | open | `conda run` 吞日志；MPS fp32 内存；`.cuda()` | `start.sh:42`、`mps_backend.py:196` | ⚠️ 部分 | P1 |
| 35 | 盼支持 M5 | open | 同 #36 | 同 #36 | ❌ | P2（合并） |
| 32 | 多卡部署 | open | 单卡、单 worker、写死设备 | `Dockerfile.v4.0:11`、`web_service_unified.py:45,231,40,70` | ✅ | P2 |
| 31 | 大 PDF 导致 Docker 卡死 | open | 旧版同步渲染阻塞事件循环；全页 base64 一次返回 | `web_service_gpu.py:286-339`、`web_service_unified.py:493-561` | ✅ | P1 |
| 30 | BFloat16 vs float（Linux+nvidia） | **closed** | 同 #40；e4c8fb5 没修到根因，属误关 | `cuda_backend.py:18-29`（无效修复） | ✅ | **P0**（应重开） |
| 27 | attention_mask 警告 | **closed** | 修复不在活跃代码路径里 | `transformers_backend.py`（无 pad_token_id） | ✅ | P2 |
| 23 | model_type 警告 / 远程代码更新 | **closed** | 警告无害；不钉 revision 是供应链风险 | `backends/*`、`Dockerfile.v4.0:32-35` | ✅ | P2 |

统计：P0 = 3（#46 #40 #30，同一根因簇）；P1 = 7（#50 #49 #45 #42 #39 #36 #31）；P2 = 8。

---

## 共性根因

### 1. 远程代码设备/dtype 写死 + 后端静默降级（#30 #40 #45 #46 #39 #36 #35）
- 上游 `modeling_deepseekocr*.py` 的 `infer()` 假定 **CUDA + bf16**：输入写死 `.to(torch.bfloat16)`，autocast 写死 `"cuda"`，OCR-2 还写死 `.cuda()`。
- 本项目的 CPU 和 MPS 后端用 fp32 加载，却直接调用上游 `infer()`，**不可能成功**：v3.x 报 bf16/float 不匹配，v4.x 报 `.cuda()` 失败。
- `detect_platform()`（`web_service_unified.py:153-187`）在 CUDA 不可用时**静默回退到 CPU**，把"驱动太旧"（#46）伪装成"dtype 错误"（#30/#40）。e4c8fb5 的 fp16 回退只针对 sm<80，根因没碰到，#30 因此被误关。
- **一次性修法**：vendor 或 monkeypatch 一份设备无关的 `infer`（按 `self.device` 搬运、按模型 dtype 转换、非 CUDA 用 nullcontext）；`detect_platform` 在期望 GPU 却不可用时 fail fast，并打出驱动版本；`/health` 返回 `backend/dtype/cuda_version/driver`。

### 2. 基础镜像过新（#46 → #30 #40；#38）
- `nvcr.io/nvidia/pytorch:25.09-py3`（CUDA 13.0）要求驱动 ≥580，消费级卡又没有 forward compat。大量 550/570 驱动的用户会直接中招。
- 镜像里打包了模型，体积很大，Windows 和弱网下难以拉取。
- **修法**：CUDA 12.x 基础镜像（或者双 tag）；slim 镜像加模型 volume；文档写明驱动下限。

### 3. 不钉 revision（#23 #39，间接 #30）
- `trust_remote_code=True` 又不钉 revision：远程代码随上游漂移；LOCAL_MODEL_PATH 也绕过了 pin。这既是行为不一致的来源，也是供应链风险。
- **修法**：单一常量 `OCR2_REVISION`，backend 和 Dockerfile 预下载处都引用它；运行时 `HF_HUB_OFFLINE=1`。

### 4. PDF 全量化处理：全页 base64 返回 + 逐页全量复制（#31 #50 #51）
- 后端：`/pdf-to-images` 把所有页的 base64 PNG 塞进一个 JSON（`web_service_unified.py:493-561`）；旧版还在 async 里同步执行，阻塞事件循环（`web_service_gpu.py:286-339`）。
- 前端：File 先转 base64 再转 ArrayBuffer，要复制 3 份；每渲染一页都 `slice(0)` 复制整本 PDF，postMessage 结构化克隆，worker 每页重新解析；scale 2.5 的 PNG 全部进 IndexedDB。
- 上传上限 100MB 在两处硬编码。在上面这些问题修好之前**不能简单调大**。
- **修法**：worker 常驻缓存 PDFDocumentProxy；ArrayBuffer 只 transfer 一次；输出用 JPEG/WebP、scale 2.0；后端分页或流式，并给出页数、大小上限（错误四要素）；上限集中到一个 `Limits`。

### 5. 静默失败和吞错误（#49 #39 #47 #46）
- `markdown.ts:140` 和 `ocr-parser.ts:73` 解析失败时 `return null`，内容直接丢掉。
- `providers.ts:95-99` 丢掉了后端 500 的 `error` 正文。
- `resumeBatchOCR` 遇到没有图片的页静默跳过（`ocr/index.ts:229-233`）。
- `web_service_unified.py:218` 用裸 `except:` 吞掉 HF 加载失败，转而尝试 ModelScope，真实错误（比如 flash-attn 在 sm<80 上不可用）被掩盖。
- `parse_detections` 里的 `except: continue`（`web_service_unified.py:326-327`）。
- 这些都违反"降级必须留痕"：降级可以，但"没查/失败"必须和"成功"可区分。

### 6. 前端后台标签页节流（#47）
- OCR 队列、健康检查、重试全部由主线程 setTimeout 驱动，隐藏标签页受 intensive throttling、冻结、丢弃影响。服务端不感知客户端断开，per-client=1 的配额在重载后会被旧请求占住。
- **修法**：`visibilitychange` 时恢复队列；服务端检测 `request.is_disconnected()`；resume 路径对缺图页显式报错。

### 7. 并发模型是"单卡单 worker"（#32）
- `CUDA_VISIBLE_DEVICES=0` 写在镜像 ENV 里，`max_workers=1`，`Semaphore(1)`，per-IP=4 而且信任 `X-Forwarded-For`。多用户场景下要么扩容器，要么做 N 卡 worker 池。

### 8. Mac 安装链路不闭环（#42 #36 #35）
- requirements-mac 缺 torch/accelerate；`conda run` 不加 `--no-capture-output`，日志被吞；`frontend/dist` 不入库，脚本也不构建；env 名硬编码。就算全部修好，v4.x 仍然被共性根因 1 卡住。

---

## 建议的修复顺序

1. **P0 簇（#46/#40/#30）**：换 CUDA 12.x 基础镜像，让 `detect_platform` fail fast，重开 #30。在 Linux 上用驱动 550 的机器或 `CUDA_VISIBLE_DEVICES=""` 做回归验证。
2. **#49**：共享的 det 解析函数加 fixture 测试（纯前端，半天能完成），同时修好 ocr-parser.ts 的同一个 bug。
3. **设备无关的 infer**（#45/#39/#36）：一个补丁解锁 CPU 和 MPS，并钉住 OCR-2 的 revision（#23）。
4. **PDF 管线瘦身**（#31/#50/#51）：做完之后再放宽上传上限。
5. 其余 P2：#44 回复后关闭，#35 合并进 #36，#32 补文档，#27 一行修复，#47 加 visibility 恢复，#38 请用户补日志并提供 slim 镜像。
