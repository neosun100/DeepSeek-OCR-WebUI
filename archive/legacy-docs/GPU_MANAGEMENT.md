# 🎯 GPU 智能管理指南

## 📋 概述

DeepSeek-OCR 现已支持 GPU 智能管理，实现：
- ✅ **懒加载**：首次使用时才加载模型
- ✅ **即用即卸**：任务完成后立即释放显存
- ✅ **自动选择**：启动时自动选择最空闲的 GPU
- ✅ **CPU 缓存**：模型在 CPU 和 GPU 之间快速切换

---

## 🚀 快速开始

### 一键启动

```bash
./start_gpu.sh
```

脚本会自动：
1. 检查 nvidia-docker 环境
2. 扫描所有 GPU，选择显存占用最少的
3. 创建 `.env` 配置文件
4. 启动 Docker 容器

---

## 🔧 工作原理

### 状态转换

```
未加载 ──首次请求(20-30s)──→ GPU ──任务完成(2s)──→ CPU ──新请求(2-5s)──→ GPU
  ↑                                                      ↓
  └────────────────────超时/手动释放(1s)─────────────────┘
```

### 三种状态

| 状态 | 位置 | 显存占用 | 切换时间 |
|------|------|----------|----------|
| **未加载** | 磁盘 | 0 MB | 首次加载 20-30s |
| **GPU** | GPU | ~7 GB | 立即可用 |
| **CPU 缓存** | CPU | 0 MB (GPU) | 恢复到 GPU 2-5s |

---

## 📊 API 端点

### 1. 健康检查

```bash
curl http://localhost:8001/health
```

**响应示例**：
```json
{
  "status": "healthy",
  "backend": "cuda",
  "platform": "Linux",
  "gpu_manager": true,
  "model_location": "cpu",
  "idle_time": 45.2,
  "device": "cuda",
  "timeout": 60,
  "gpu_memory_allocated": 0.5,
  "gpu_memory_reserved": 2.0
}
```

### 2. GPU 状态查询

```bash
curl http://localhost:8001/gpu/status
```

**响应示例**：
```json
{
  "model_location": "cpu",
  "idle_time": 120.5,
  "device": "cuda",
  "timeout": 60,
  "gpu_memory_allocated": 0.5,
  "gpu_memory_reserved": 2.0
}
```

### 3. 手动卸载 GPU

```bash
curl -X POST http://localhost:8001/gpu/offload
```

**作用**：立即将模型从 GPU 转移到 CPU，释放显存

### 4. 完全释放资源

```bash
curl -X POST http://localhost:8001/gpu/release
```

**作用**：清空 GPU 和 CPU 缓存，完全释放内存

---

## ⚙️ 配置参数

### 环境变量

在 `.env` 文件中配置：

```bash
# 服务端口
PORT=8001

# GPU ID（自动选择）
NVIDIA_VISIBLE_DEVICES=0

# GPU 空闲超时（秒）
GPU_IDLE_TIMEOUT=60

# 强制使用特定后端（可选）
# FORCE_BACKEND=cuda
```

### 超时配置

| 超时时间 | 适用场景 |
|---------|---------|
| 30-60s | 频繁使用（推荐） |
| 120-300s | 中等频率 |
| 600s+ | 低频使用 |

---

## 🧪 测试验证

### 1. 检查容器状态

```bash
docker ps | grep deepseek-ocr-gpu
```

### 2. 查看日志

```bash
docker logs -f deepseek-ocr-gpu
```

### 3. 测试 OCR

```bash
curl -X POST http://localhost:8001/ocr \
  -F "file=@test.png" \
  -F "prompt_type=document"
```

### 4. 监控 GPU 显存

```bash
# 实时监控
watch -n 1 nvidia-smi

# 查看指定 GPU
nvidia-smi -i 0 --query-gpu=memory.used,memory.total --format=csv
```

### 5. 验证懒加载

```bash
# 步骤1: 查看初始状态（应该是 unloaded）
curl http://localhost:8001/gpu/status

# 步骤2: 发送 OCR 请求
curl -X POST http://localhost:8001/ocr -F "file=@test.png"

# 步骤3: 立即查看状态（应该是 cpu，因为已卸载）
curl http://localhost:8001/gpu/status

# 步骤4: 等待超时后查看（应该还是 cpu）
sleep 70
curl http://localhost:8001/gpu/status
```

---

## 📈 性能对比

### 显存占用

| 阶段 | 传统方式 | GPU 管理 | 节省 |
|------|---------|---------|------|
| 空闲时 | ~7 GB | < 1 GB | ~6 GB |
| 处理中 | ~7 GB | ~7 GB | 0 GB |
| 处理后 | ~7 GB | < 1 GB | ~6 GB |

### 响应时间

| 场景 | 时间 | 说明 |
|------|------|------|
| 首次请求 | 20-30s | 从磁盘加载模型 |
| 后续请求（GPU） | < 1s | 模型已在 GPU |
| 后续请求（CPU 缓存） | 2-5s | 从 CPU 恢复到 GPU |

---

## 🔍 故障排查

### 问题1: GPU 未被识别

**症状**：日志显示 "CPU mode"

**解决**：
```bash
# 检查 NVIDIA 驱动
nvidia-smi

# 检查 Docker GPU 支持
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# 重启 Docker
sudo systemctl restart docker
```

### 问题2: 显存未释放

**症状**：`gpu/status` 显示 GPU 占用高

**解决**：
```bash
# 手动卸载
curl -X POST http://localhost:8001/gpu/offload

# 完全释放
curl -X POST http://localhost:8001/gpu/release

# 重启容器
docker restart deepseek-ocr-gpu
```

### 问题3: 模型加载失败

**症状**：首次请求超时

**解决**：
```bash
# 检查模型缓存
ls -lh ./models/hub/models--deepseek-ai--DeepSeek-OCR/

# 清空缓存重新下载
rm -rf ./models/hub/models--deepseek-ai--DeepSeek-OCR/
docker restart deepseek-ocr-gpu
```

---

## 🎯 最佳实践

### 1. 生产环境

```bash
# 设置较长的超时时间
GPU_IDLE_TIMEOUT=300

# 启用健康检查
docker compose -f docker-compose.gpu.yml up -d
```

### 2. 开发环境

```bash
# 设置较短的超时时间
GPU_IDLE_TIMEOUT=30

# 查看实时日志
docker logs -f deepseek-ocr-gpu
```

### 3. 多 GPU 环境

```bash
# 方法1: 手动指定 GPU
NVIDIA_VISIBLE_DEVICES=1 ./start_gpu.sh

# 方法2: 修改 .env
echo "NVIDIA_VISIBLE_DEVICES=1" > .env
docker compose -f docker-compose.gpu.yml up -d
```

---

## 📞 支持

遇到问题？
1. 查看日志：`docker logs deepseek-ocr-gpu`
2. 检查 GPU：`nvidia-smi`
3. 提交 Issue：[GitHub Issues](https://github.com/neosun100/DeepSeek-OCR-WebUI/issues)

---

**Made with ❤️ by DeepSeek-OCR Team**
