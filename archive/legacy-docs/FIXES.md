# 🔧 Issues 修复说明

本文档记录了针对 GitHub Issues 的修复方案。

## 修复日期
2025-12-05

---

## ✅ Issue #28: Swagger UI 静态文件问题

**问题描述**: `/docs` 路径访问的 CDN 资源（`https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css`）在内网无法使用

**修复方案**:
- 配置 FastAPI 禁用外部 CDN，使用内置的 Swagger UI
- 添加 `swagger_ui_parameters` 配置

**修改文件**:
- `web_service_unified.py`

**使用方法**:
```python
app = FastAPI(
    swagger_ui_parameters={"syntaxHighlight": False}
)
```

---

## ✅ Issue #27: attention_mask 警告

**问题描述**: 
```
The attention mask and the pad token id were not set.
Setting `pad_token_id` to `eos_token_id`:None for open-end generation.
```

**修复方案**:
- 在 `generate()` 调用时显式设置 `pad_token_id`

**修改文件**:
- `backends/transformers_backend.py`

**代码修改**:
```python
outputs = self.model.generate(
    **inputs,
    max_new_tokens=kwargs.get('max_tokens', 2048),
    temperature=kwargs.get('temperature', 0.0),
    do_sample=False,
    pad_token_id=self.processor.tokenizer.eos_token_id  # 新增
)
```

---

## ✅ Issue #24 & #16: Mac M4/M2 BFloat16 错误

**问题描述**: 
```
Input type (c10::BFloat16) and bias type (float) should be the same
```

**修复方案**:
- 在 MPS backend 中禁用 Flash Attention
- 确保使用 `attn_implementation="eager"`

**修改文件**:
- `backends/mps_backend.py`

**代码修改**:
```python
self.model = AutoModel.from_pretrained(
    self.model_path,
    revision=self.revision,
    trust_remote_code=True,
    torch_dtype=torch.float32,
    low_cpu_mem_usage=True,
    attn_implementation="eager"  # 新增：禁用 flash attention
).to(self.device)
```

---

## ✅ Issue #25 & #20: 本地模型路径支持

**问题描述**: 
- 每次运行 Docker 都会重新下载模型
- 希望能够使用本地已下载的模型

**修复方案**:
- 添加环境变量 `LOCAL_MODEL_PATH` 支持
- 自动检测并使用本地模型路径

**修改文件**:
- `web_service_unified.py`
- `docker-compose.yml`

**使用方法**:

### Docker 方式:
```yaml
# docker-compose.yml
environment:
  - LOCAL_MODEL_PATH=/app/local_models

volumes:
  - /path/to/your/model:/app/local_models
```

### 本地运行:
```bash
export LOCAL_MODEL_PATH=/path/to/your/model
./start.sh
```

**示例**:
```bash
# 如果你已经下载了模型到 ~/models/DeepSeek-OCR
export LOCAL_MODEL_PATH=~/models/DeepSeek-OCR
python web_service_unified.py
```

---

## ✅ Issue #19: Markdown 渲染支持

**问题描述**: 
- 生成的 Markdown 格式需要额外工具查看
- 表格等内容不友好

**修复方案**:
- 集成 `marked.js` 实现 Markdown 实时预览
- 添加"预览 Markdown"按钮
- 支持原文/预览切换

**修改文件**:
- `ocr_ui_modern.html`

**功能特性**:
- ✅ 自动检测 "Doc to Markdown" 模式
- ✅ 显示预览按钮
- ✅ 一键切换原文/渲染视图
- ✅ 支持表格、列表、代码块等 Markdown 语法

**使用方法**:
1. 选择 "📄 Doc to Markdown" 模式
2. 上传图片并识别
3. 点击 "👁️ 预览 Markdown" 按钮查看渲染效果
4. 点击 "查看原文" 返回原始文本

---

## 📝 待处理 Issues

### Issue #26: web_service_vllm_backup.py 依赖
**状态**: 需要用户确认
**建议**: 该文件是备份文件，不需要安装 vLLM 依赖

### Issue #23: deepseek_vl_v2 类型警告
**状态**: 警告信息，不影响功能
**说明**: 这是 transformers 库的兼容性警告，可以忽略

### Issue #18: NVIDIA 驱动升级后 CUDA 错误
**状态**: 需要重建 Docker 镜像
**建议**: 
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Issue #17: 图文 Markdown 功能
**状态**: 功能增强请求
**说明**: 需要实现图片提取和关联功能，计划在后续版本实现

### Issue #12: OCR 模式识别不全
**状态**: 需要更多信息
**建议**: 提供测试图片和详细日志

---

## 🚀 如何应用这些修复

### 方法 1: 拉取最新代码
```bash
cd DeepSeek-OCR-WebUI
git pull origin main
```

### 方法 2: Docker 重新构建
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### 方法 3: 本地运行
```bash
# 激活环境
conda activate deepseek-ocr-mlx

# 重启服务
./start.sh
```

---

## 📞 反馈

如果遇到问题或有新的建议，请在 GitHub Issues 中反馈：
https://github.com/neosun100/DeepSeek-OCR-WebUI/issues

---

## 📄 许可证

MIT License © 2025 neosun100
