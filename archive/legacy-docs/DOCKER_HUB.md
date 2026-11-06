# DeepSeek-OCR Docker Hub 镜像

## 🎉 v3.6 发布 - 后端并发优化与限流

**Docker Hub**: `neosun/deepseek-ocr`

### 🆕 v3.6 新特性

- ⚡ **后端并发优化** - ThreadPoolExecutor 非阻塞推理
- 🔒 **限流机制** - 支持按客户端和 IP 限制请求
- 📊 **队列管理** - 实时队列状态和位置追踪
- 🏥 **增强健康 API** - 队列深度、状态指示
- 🌐 **新增语言** - 繁体中文 (zh-TW)、日语 (ja-JP)
- 🎯 **429 错误处理** - 队列满或限流时的优雅处理

### 镜像特点

✅ **完全独立** - 包含所有依赖和预下载的模型  
✅ **无需外部下载** - 首次启动即可使用  
✅ **GPU 加速** - 支持 NVIDIA GPU (CUDA)  
✅ **Vue 3 前端** - 现代化响应式 UI  
✅ **生产就绪** - 经过完整测试验证  

---

## 🌐 在线 Demo

- **主站**: https://deepseek-ocr.aws.xin/
- **GitHub Pages**: https://neosun100.github.io/DeepSeek-OCR-WebUI/

---

## 🚀 快速开始

### 1. 拉取镜像

```bash
docker pull neosun/deepseek-ocr:v3.6
```

或使用 latest：

```bash
docker pull neosun/deepseek-ocr:latest
```

### 2. 运行容器

**使用 GPU**:
```bash
docker run -d \
  --name deepseek-ocr \
  --gpus all \
  -p 8001:8001 \
  --shm-size=8g \
  --restart unless-stopped \
  neosun/deepseek-ocr:v3.6
```

**仅 CPU** (不推荐，速度很慢):
```bash
docker run -d \
  --name deepseek-ocr \
  -p 8001:8001 \
  neosun/deepseek-ocr:v3.6
```

### 3. 访问服务

- **Web UI**: http://localhost:8001
- **API**: http://localhost:8001/ocr
- **健康检查**: http://localhost:8001/health
- **API 文档**: http://localhost:8001/docs

---

## 📋 可用标签

| 标签 | 说明 | 发布日期 |
|------|------|----------|
| `latest` | 最新稳定版本 (= v3.6) | 2026-01-20 |
| `v3.6` | 后端并发优化与限流 | 2026-01-20 |
| `v3.5.1` | Vue 3 前端版本 | 2026-01-17 |
| `v3.5` | Vue 3 前端版本 | 2026-01-17 |
| `v3.3.1-fix-bfloat16` | BFloat16 兼容性修复 | 2025-12-16 |
| `v3.3-allinone` | v3.3 完整版本 | 2025-12-07 |

---

## 🔌 API 端点

### 1. 健康检查 (v3.6 增强)
```bash
curl http://localhost:8001/health
```

响应示例：
```json
{
  "status": "healthy",
  "backend": "cuda",
  "model_loaded": true,
  "ocr_queue": {
    "depth": 0,
    "max_size": 8,
    "is_full": false
  },
  "rate_limits": {
    "max_per_client": 1,
    "max_per_ip": 4
  }
}
```

### 2. 单图片 OCR
```bash
curl -X POST http://localhost:8001/ocr \
  -H "X-Client-ID: my-client-001" \
  -F "file=@image.png" \
  -F "prompt_type=ocr"
```

### 3. PDF 转图片
```bash
curl -X POST http://localhost:8001/pdf-to-images \
  -F "file=@document.pdf"
```

---

## 🐳 Docker Compose

创建 `docker-compose.yml`:

```yaml
version: '3.8'

services:
  deepseek-ocr:
    image: neosun/deepseek-ocr:v3.6
    container_name: deepseek-ocr
    ports:
      - "8001:8001"
    shm_size: 8g
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5m
```

启动：
```bash
docker compose up -d
```

---

## 📊 系统要求

### 最低配置
- **GPU**: NVIDIA GPU with 16GB+ VRAM (推荐 24GB+)
- **RAM**: 16GB+
- **磁盘**: 50GB+ 可用空间
- **CUDA**: 11.8+

### 推荐配置
- **GPU**: NVIDIA A100 / RTX 4090 / L40S
- **RAM**: 32GB+
- **磁盘**: 100GB+ SSD

---

## 🔧 环境变量

```bash
docker run -d \
  --name deepseek-ocr \
  --gpus all \
  -p 8001:8001 \
  -e CUDA_VISIBLE_DEVICES=0 \
  --shm-size=8g \
  neosun/deepseek-ocr:v3.6
```

---

## 📝 更新日志

### v3.6 (2026-01-20) - 后端并发优化与限流
- ✅ ThreadPoolExecutor 非阻塞推理
- ✅ asyncio.Semaphore 并发控制 (OCR: 1, PDF: 2)
- ✅ 队列系统 MAX_OCR_QUEUE_SIZE=8
- ✅ 按 IP 和客户端 ID 限流
- ✅ 429 错误处理
- ✅ 健康指示器 3 种状态 (绿/黄/红)
- ✅ 新增繁体中文、日语支持
- 🙏 贡献者: [@cloudman6](https://github.com/cloudman6)

### v3.5 (2026-01-17) - Vue 3 前端
- ✅ Vue 3 + TypeScript + Naive UI
- ✅ Dexie.js 本地数据库
- ✅ 实时处理队列
- ✅ E2E 测试覆盖
- 🙏 贡献者: [@cloudman6](https://github.com/cloudman6)

### v3.3.1 (2025-12-16) - BFloat16 修复
- ✅ 修复 RTX 20xx、GTX 10xx GPU 兼容性

### v3.3-allinone (2025-12-07)
- ✅ 包含预下载的模型
- ✅ 支持 MCP 协议

---

## 🐛 故障排除

### 问题 1: 容器启动失败
```bash
docker logs deepseek-ocr
nvidia-smi
```

### 问题 2: 内存不足
```bash
docker run --shm-size=16g ...
```

### 问题 3: 429 Too Many Requests
- 检查 `/health` 查看队列状态
- 等待队列空闲后重试
- 使用 `X-Client-ID` header 追踪请求

---

## 📖 完整文档

- **GitHub**: https://github.com/neosun100/DeepSeek-OCR-WebUI
- **API 文档**: [API.md](https://github.com/neosun100/DeepSeek-OCR-WebUI/blob/main/API.md)
- **MCP 支持**: [MCP_SETUP.md](https://github.com/neosun100/DeepSeek-OCR-WebUI/blob/main/MCP_SETUP.md)

---

## 📞 支持

- **Issues**: https://github.com/neosun100/DeepSeek-OCR-WebUI/issues
- **Demo**: https://neosun100.github.io/DeepSeek-OCR-WebUI/

---

## 📄 许可证

MIT License - 详见 [LICENSE](https://github.com/neosun100/DeepSeek-OCR-WebUI/blob/main/LICENSE)

---

**⭐ 如果这个项目对你有帮助，请给个 Star！**

**Made with ❤️ by [neosun100](https://github.com/neosun100) & [cloudman6](https://github.com/cloudman6)**
