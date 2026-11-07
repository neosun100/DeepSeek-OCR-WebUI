# 📝 更新日志 / Changelog

所有重要的项目变更都会记录在此文件中。

---

## [v4.1] - 2026-02-20

### 🏷️ UI Improvements & Model Version Display

**前端改进：**
- Header 新增 `OCR-2` 绿色模型标识，用户一眼即知当前模型版本
- 修复表格渲染：OCR 识别的表格现在显示白色背景、深色文字、斑马纹交替行，解决之前深色背景导致内容不可读的问题
- Footer 版本更新为 `v4.1 · OCR-2`

**API 改进：**
- `/health` 接口新增 `model_version: "DeepSeek-OCR-2"` 字段，支持程序化版本检测

**技术细节：**
- `Preview.vue` — 表格 CSS 增加 `background-color: #ffffff`, `color: #1f2937`, `tr:nth-child(even)` 斑马纹
- `AppHeader.vue` — 新增 `.model-badge` 组件（绿色渐变背景圆角标签）
- `EmptyState.vue` — 版本号 v3.6 → v4.1 · OCR-2
- `web_service_unified.py` — health response 增加 `model_version` 字段，FastAPI version → 4.1.0

---

## [v4.0] - 2026-02-20

### 🧠 重大更新：DeepSeek-OCR-2 模型升级 / Major: DeepSeek-OCR-2 Model Upgrade

**核心升级 / Core Upgrade:**
- ✅ 模型升级至 [DeepSeek-OCR-2](https://github.com/deepseek-ai/DeepSeek-OCR-2)（Visual Causal Flow 架构）
- ✅ 动态分辨率：(0-6)×768×768 + 1×1024×1024（原 640×640）
- ✅ CUDA 环境启用 Flash Attention 2（`_attn_implementation='flash_attention_2'`）
- ✅ Tokenizer 从 `AutoProcessor` 统一为 `AutoTokenizer`（与官方 OCR-2 API 对齐）
- ✅ `image_size` 从 640 升级至 768
- ✅ 移除硬编码 revision hash，使用最新模型版本

**后端改动 / Backend Changes:**
- ✅ `backends/cuda_backend.py` - OCR-2 模型 + flash_attention_2 + image_size=768
- ✅ `backends/mps_backend.py` - OCR-2 模型 + eager attention + image_size=768
- ✅ `backends/cpu_backend.py` - OCR-2 模型 + image_size=768
- ✅ `backends/transformers_backend.py` - 重写为 model.infer() 统一接口
- ✅ `web_service_unified.py` - 默认模型路径更新
- ✅ `web_service.py` - 模型路径 + flash_attention_2 + image_size=768
- ✅ `web_service_gpu.py` - 修复 tokenizer 引用
- ✅ `web_service_vllm_backup.py` - 模型路径 + IMAGE_SIZE=768
- ✅ `mcp_server.py` - 描述文字更新

**Docker / 部署:**
- ✅ 新增 `Dockerfile.v4.0`（基于 nvcr.io/nvidia/pytorch:25.09-py3）
- ✅ 基础镜像已内置 flash-attn，无需额外编译
- ✅ 预下载 DeepSeek-OCR-2 模型（all-in-one）
- ✅ Docker tag: `neosun/deepseek-ocr:v4.0`

**兼容性 / Compatibility:**
- ✅ REST API 接口完全不变（前端零改动）
- ✅ 所有 7 种识别模式保持不变
- ✅ Prompt 格式完全兼容
- ✅ 并发控制、限流、队列管理等 v3.6 功能完全保留
- ✅ `LOCAL_MODEL_PATH` 环境变量仍可用于指定自定义模型路径

**技术对比 / Technical Comparison:**

| 组件 | v3.6 (OCR v1) | v4.0 (OCR-2) |
|------|---------------|---------------|
| 模型 | `deepseek-ai/DeepSeek-OCR` | `deepseek-ai/DeepSeek-OCR-2` |
| image_size | 640 | 768 |
| Attention | eager | flash_attention_2 (CUDA) |
| Tokenizer | AutoProcessor | AutoTokenizer |
| 分辨率 | 固定裁剪 | 动态 (0-6)×768 + 1×1024 |

---

## [v3.3.3] - 2025-11-05

### 🔧 改进 / Improvements

#### 网络访问配置优化 / Network Access Configuration
- ✅ 服务监听所有网络接口（`0.0.0.0:8001`），支持多种访问方式
- ✅ 支持本地访问：`http://localhost:8001`
- ✅ 支持局域网访问：`http://<服务器IP>:8001`
- ✅ 支持域名访问：通过反向代理转发到 `localhost:8001`
- ✅ 优化启动日志，清晰显示所有访问方式
- ✅ 更新文档，详细说明不同场景的访问配置

#### 文档完善 / Documentation Updates
- ✅ 更新 README，添加网络访问配置章节
- ✅ 详细说明本地、局域网、远程、域名四种访问方式
- ✅ 添加安全提示和防火墙配置说明
- ✅ 更新所有语言的 README（EN, ZH-CN, ZH-TW, JA）

### 🐛 Bug 修复 / Bug Fixes
- ✅ 修复 `os` 模块导入作用域问题（ModelScope 分支）
- ✅ 优化健康检查配置（5分钟启动期）

---

## [v3.2] - 2025-11-04

### 🆕 新功能 / New Features

#### PDF 上传支持 / PDF Upload Support
- ✅ 支持上传 PDF 文件（自动转换为图片）
- ✅ 多页 PDF 自动转换为多张图片
- ✅ PDF 转换进度实时显示（逐页显示）
- ✅ 支持拖拽上传 PDF
- ✅ Find 模式支持 PDF（自动使用第一页）
- ✅ 文件格式验证和错误提示

#### ModelScope 自动切换 / ModelScope Auto-Fallback
- ✅ HuggingFace 下载失败时自动切换到 ModelScope
- ✅ 智能识别网络错误和超时
- ✅ 自动重试机制（5分钟超时）
- ✅ 支持中国大陆用户无感切换
- ✅ 健康检查显示实际使用的模型源

### 🐛 Bug 修复 / Bug Fixes

- ✅ 修复 PDF 转换进度日志实时显示问题
- ✅ 修复按钮重复显示文字的国际化问题
- ✅ 修复系统初始化日志信息（版本号、服务地址、模式数量）
- ✅ 优化 PDF 转换性能（批量处理优化）

### 🔧 技术改进 / Technical Improvements

- ✅ 使用 PyMuPDF 进行高质量 PDF 转图片（144 DPI）
- ✅ 异步处理 PDF 转换，确保实时进度显示
- ✅ 添加 ModelScope 库支持
- ✅ 改进错误处理和日志记录

### 📚 文档更新 / Documentation Updates

- ✅ 更新版本号到 v3.2
- ✅ 添加 PDF 支持说明
- ✅ 添加 ModelScope 切换说明

---

## [v3.1] - 2025-10-22

### 🌐 新功能 / New Features

#### 多语言支持 / Multilingual Support
- ✅ 添加 4 种语言支持：简体中文、繁體中文、English、日本語
- ✅ UI 界面完整本地化
- ✅ 语言选择器组件（右上角）
- ✅ 本地化设置持久化（LocalStorage）
- ✅ 多语言 README 文档

#### 国际化功能 / i18n Features
- 📄 所有界面文本支持翻译
- 🔄 动态语言切换（无需刷新页面）
- 💾 语言偏好自动保存
- 🌍 SEO 友好的多语言URL

### 🐛 Bug 修复 / Bug Fixes

#### 模式切换问题 / Mode Switching Issue
**问题 / Issue**：从 Find 模式无法切换回其他模式

**修复 / Fix**：
- 将模式选择器从批量容器中提取出来
- 模式选择器现在独立显示，始终可见
- 优化模式切换逻辑

**影响 / Impact**：✅ 所有模式可以自由切换

---

#### 边界框超出问题 / Bounding Box Overflow Issue
**问题 / Issue**：Canvas 绘制的边界框超出图片边界

**修复 / Fix**：
- 图片容器改为 `display: inline-block`（紧贴图片尺寸）
- Canvas 同时设置 `width` 属性和 `style.width`（精确对齐）
- 添加渲染延迟（`requestAnimationFrame + setTimeout`）
- 图片加载完成后再绘制边界框

**技术细节 / Technical Details**：
```css
/* Before */
.find-result-image-wrapper img {
    width: 100%;
    object-fit: contain;
}

/* After */
.find-result-image-wrapper {
    display: inline-block;
}
.find-result-image-wrapper img {
    width: auto;
    max-width: 100%;
}
```

**影响 / Impact**：✅ 边界框精确在图片内，不会超出边界

---

### 🎨 UI/UX 改进 / UI/UX Improvements

- ✅ 图片居中显示（更美观）
- ✅ Canvas 响应式重绘（窗口 resize 时自动调整）
- ✅ 语言切换器集成到 Header
- ✅ 优化移动端显示

### 📚 文档更新 / Documentation Updates

- ✅ 多语言 README (zh-CN, zh-TW, en-US, ja-JP)
- ✅ 完整的版本历史记录
- ✅ CHANGELOG.md (本文件)
- ✅ BUGFIX_SUMMARY.md
- ✅ I18N_GUIDE.md (国际化指南)

### 🔧 技术改进 / Technical Improvements

- ✅ i18n.js 模块化设计
- ✅ LocalStorage 持久化
- ✅ 防抖优化（resize 事件）
- ✅ 代码结构优化

---

## [v3.0] - 2025-10-22

### ✨ 重大更新 / Major Updates

#### Find 模式 2.0 / Find Mode 2.0
**全新的左右分栏布局 / New Split Layout**：
- 🎨 专用的左右分栏界面
- 📤 左侧：操作面板（上传、输入、按钮）
- ✨ 右侧：结果展示（图片、边界框、统计、匹配项）

**边界框可视化 / Bounding Box Visualization**：
- 🖼️ Canvas API 实现
- 🎨 6 种彩色霓虹边框
- 📍 精确的坐标转换
- 🔄 响应式自动重绘

**功能特性 / Features**：
- 单图上传专用模式
- 实时边界框标注
- 匹配项详细列表
- 坐标信息展示

### 🔧 技术架构 / Technical Architecture

#### 引擎切换 / Engine Migration
**从 vLLM 切换到 transformers / Switch from vLLM to transformers**：

**原因 / Reason**：
- vLLM CUDA 版本兼容问题
- `libcudart.so.11.0` 依赖冲突
- ABI 版本不匹配

**解决方案 / Solution**：
- 使用 transformers 引擎（更稳定）
- CUDA 版本匹配
- 去除 vLLM 依赖

**影响 / Impact**：
- ✅ 更好的稳定性
- ✅ 更容易部署
- ⚠️ 推理速度略慢（但可接受）

### 📊 坐标系统 / Coordinate System

**精确的坐标转换 / Accurate Coordinate Transformation**：
```
模型输出 (0-999) → 像素坐标 → 显示坐标
Model Output → Pixel Coords → Display Coords
```

**技术细节 / Technical Details**：
1. 模型输出归一化坐标 (0-999)
2. 后端转换为像素坐标（基于原始图片尺寸）
3. 前端缩放到显示尺寸
4. Canvas 绘制

### 🎨 UI 组件 / UI Components

- ✅ 玻璃态设计（Glass Morphism）
- ✅ 渐变背景动画
- ✅ 霓虹发光效果
- ✅ 响应式布局

### 📚 文档 / Documentation

新增文档 / New Docs：
- FIND_MODE_V2_GUIDE.md - Find 模式详细指南
- QUICK_START.md - 快速开始
- ENHANCED_FEATURES.md - 功能说明
- DEPLOYMENT_SUMMARY.md - 部署总结

---

## [v2.0] - 2025-10-21

### 🎯 核心功能 / Core Features

#### 批量处理 / Batch Processing
- ✅ 支持多图片上传
- ✅ 拖拽排序功能
- ✅ 逐一顺序处理
- ✅ 实时进度跟踪

#### 7 种识别模式 / 7 Recognition Modes
1. 📄 文档转Markdown / Document to Markdown
2. 📝 通用OCR / General OCR
3. 📋 纯文本提取 / Plain Text
4. 📊 图表解析 / Chart Parser
5. 🖼️ 图像描述 / Image Description
6. 🔍 查找定位 / Find & Locate (v3.0)
7. ✨ 自定义提示 / Custom Prompt

#### 日志系统 / Logging System
- ✅ 详细的操作日志
- ✅ 多种日志级别（info, success, error）
- ✅ 时间戳记录
- ✅ 结构化数据展示

### 🐳 Docker 支持 / Docker Support

**容器化部署 / Containerized Deployment**：
```yaml
services:
  deepseek-ocr-webui:
    build: .
    ports:
      - "8001:8001"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

**特性 / Features**：
- ✅ 一键启动
- ✅ GPU 自动配置
- ✅ 健康检查
- ✅ 自动重启
- ✅ 卷挂载（模型缓存）

### 📊 性能优化 / Performance Optimization

- ✅ 批量处理优化
- ✅ 内存管理
- ✅ GPU 加速
- ✅ 并发控制

---

## [v1.0] - 2025-10-20

### 🎉 首次发布 / Initial Release

#### 基础功能 / Basic Features
- ✅ OCR 图像识别
- ✅ Web UI 界面
- ✅ DeepSeek-OCR 模型集成
- ✅ 基础的批处理支持

#### 技术栈 / Tech Stack
- **后端 / Backend**: FastAPI + transformers
- **前端 / Frontend**: 纯 HTML/CSS/JavaScript
- **模型 / Model**: DeepSeek-OCR
- **部署 / Deploy**: Python 脚本

#### 文档 / Documentation
- ✅ README.md
- ✅ 基础使用说明

---

## 📅 版本计划 / Version Roadmap

### [v3.2] - 计划中 / Planned

**功能增强 / Feature Enhancements**：
- [ ] 批量 Find 模式（处理多张图片的查找任务）
- [ ] 导出标注图片（带边界框的图片）
- [ ] 坐标数据导出（JSON/CSV）
- [ ] 历史记录功能

**性能优化 / Performance**：
- [ ] 并发处理优化
- [ ] 缓存机制
- [ ] 压缩优化

**UI/UX**：
- [ ] 深色/浅色主题切换
- [ ] 更多动画效果
- [ ] 移动端优化

### [v4.0] - 远期规划 / Future Plans

**高级功能 / Advanced Features**：
- [ ] 用户系统（登录、权限）
- [ ] API Key 管理
- [ ] 使用统计和分析
- [ ] 模型微调支持
- [ ] 插件系统

**企业功能 / Enterprise Features**：
- [ ] 团队协作
- [ ] 任务队列
- [ ] 审计日志
- [ ] SSO 集成

---

## 🔄 升级指南 / Upgrade Guide

### 从 v3.0 升级到 v3.1 / Upgrade from v3.0 to v3.1

```bash
# 1. 停止服务
docker compose down

# 2. 拉取最新代码
git pull origin main

# 3. 重新构建
docker compose build --no-cache

# 4. 启动服务
docker compose up -d

# 5. 验证
curl http://localhost:8001/health
```

**注意事项 / Notes**：
- ✅ 无需数据迁移（无破坏性更新）
- ✅ 配置文件兼容
- ✅ 向后兼容 API

### 从 v2.0 升级到 v3.0 / Upgrade from v2.0 to v3.0

**重要变更 / Breaking Changes**：
- ⚠️ vLLM → transformers（引擎变更）
- ⚠️ 部分配置文件更新
- ⚠️ Docker 镜像基础版本变更

**升级步骤 / Steps**：
```bash
# 1. 备份数据
docker compose down
cp -r ./models ./models.backup

# 2. 更新代码
git pull origin main

# 3. 更新配置（如果需要）
# 检查 docker-compose.yml

# 4. 重新构建
docker compose build --no-cache

# 5. 启动并测试
docker compose up -d
docker logs -f deepseek-ocr-webui
```

---

## 📞 支持 / Support

### 报告问题 / Report Issues

如果你发现 bug 或有功能建议：

1. 检查 [已知问题](./KNOWN_ISSUES.md)
2. 搜索 [Issues](https://github.com/neosun100/DeepSeek-OCR-WebUI/issues)
3. 提交新的 Issue

### 贡献代码 / Contributing

请参考 [贡献指南](./CONTRIBUTING.md)

---

## 📄 许可证 / License

MIT License © 2025 [neosun100](https://github.com/neosun100)

---

<div align="center">

**🌟 感谢使用 DeepSeek-OCR-WebUI！🌟**

[主页](https://github.com/neosun100/DeepSeek-OCR-WebUI) • [文档](./README.md) • [问题](https://github.com/neosun100/DeepSeek-OCR-WebUI/issues)

</div>
