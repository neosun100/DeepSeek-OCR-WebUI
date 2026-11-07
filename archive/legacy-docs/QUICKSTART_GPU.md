# 🚀 GPU 智能管理 - 快速开始

## ✨ 核心特性

- ✅ **懒加载**：首次使用时才加载模型（20-30秒）
- ✅ **即用即卸**：任务完成后立即释放显存（2秒）
- ✅ **CPU 缓存**：模型在 CPU 和 GPU 之间快速切换（2-5秒）
- ✅ **自动选择**：启动时自动选择最空闲的 GPU
- ✅ **自动监控**：空闲超时后自动卸载到 CPU

---

## 🎯 一键启动

```bash
./start_gpu.sh
```

**输出示例**：
```
==================================================
🚀 DeepSeek-OCR with GPU Management
==================================================
✅ NVIDIA Docker environment OK

🔍 Detecting available GPUs...
0, NVIDIA L40S, 22331 MiB, 46068 MiB
1, NVIDIA L40S, 433 MiB, 46068 MiB
2, NVIDIA L40S, 3 MiB, 46068 MiB  ← 自动选择
3, NVIDIA L40S, 3 MiB, 46068 MiB

✅ Selected GPU 2: NVIDIA L40S
   Memory: 3MB / 46068MB used

📍 Access URLs:
   - Local:  http://localhost:8001
   - Remote: http://192.168.1.100:8001
```

---

## 📊 工作流程

### 状态转换图

```
未加载 ──首次请求(20-30s)──→ GPU ──任务完成(2s)──→ CPU ──新请求(2-5s)──→ GPU
  ↑                                                      ↓
  └────────────────────超时/手动释放(1s)─────────────────┘
```

### 显存占用

| 阶段 | 传统方式 | GPU 管理 | 节省 |
|------|---------|---------|------|
| 空闲时 | ~7 GB | < 1 GB | ~6 GB |
| 处理中 | ~7 GB | ~7 GB | 0 GB |
| 处理后 | ~7 GB | < 1 GB | ~6 GB |

---

## 🔧 API 端点

### 1. 健康检查

```bash
curl http://localhost:8001/health
```

**响应**：
```json
{
  "status": "healthy",
  "backend": "cuda",
  "platform": "Linux",
  "gpu_manager": true,
  "model_location": "unloaded",
  "idle_time": 0,
  "device": "cuda",
  "timeout": 60,
  "gpu_memory_allocated": 0.0,
  "gpu_memory_reserved": 0.0
}
```

### 2. GPU 状态

```bash
curl http://localhost:8001/gpu/status
```

**响应**：
```json
{
  "model_location": "cpu",
  "idle_time": 45.2,
  "device": "cuda",
  "timeout": 60,
  "gpu_memory_allocated": 0.5,
  "gpu_memory_reserved": 2.0
}
```

### 3. 手动卸载

```bash
curl -X POST http://localhost:8001/gpu/offload
```

**作用**：立即将模型从 GPU 转移到 CPU

### 4. 完全释放

```bash
curl -X POST http://localhost:8001/gpu/release
```

**作用**：清空 GPU 和 CPU 缓存

---

## 🧪 测试验证

### 运行测试套件

```bash
./test_gpu_management.sh
```

### 手动测试

```bash
# 1. 查看初始状态
curl http://localhost:8001/gpu/status

# 2. 上传图片进行 OCR（通过 Web UI）
# 访问 http://localhost:8001

# 3. 查看处理后状态（应该是 cpu）
curl http://localhost:8001/gpu/status

# 4. 监控 GPU 显存
watch -n 1 nvidia-smi
```

---

## 📈 性能指标

### 响应时间

| 场景 | 时间 | 说明 |
|------|------|------|
| 首次请求 | 20-30s | 从磁盘加载模型 |
| 后续请求（GPU） | < 1s | 模型已在 GPU |
| 后续请求（CPU 缓存） | 2-5s | 从 CPU 恢复到 GPU |
| 卸载到 CPU | ~2s | 释放 GPU 显存 |
| 完全释放 | ~1s | 清空所有缓存 |

### 显存节省

- **空闲时节省**：~6 GB（85%）
- **多服务共享**：可在同一 GPU 上运行更多服务
- **成本优化**：减少 GPU 资源浪费

---

## ⚙️ 配置

### 环境变量（.env）

```bash
# 服务端口
PORT=8001

# GPU ID（自动选择最空闲的）
NVIDIA_VISIBLE_DEVICES=2

# GPU 空闲超时（秒）
GPU_IDLE_TIMEOUT=60
```

### 超时建议

| 使用频率 | 超时时间 | 说明 |
|---------|---------|------|
| 高频（每分钟多次） | 30-60s | 快速响应 |
| 中频（每小时数次） | 120-300s | 平衡性能 |
| 低频（每天数次） | 600s+ | 最大节省 |

---

## 🔍 监控

### 实时监控 GPU

```bash
# 方法1: nvidia-smi
watch -n 1 nvidia-smi

# 方法2: 只看显存
watch -n 1 'nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv'

# 方法3: 查看指定 GPU
nvidia-smi -i 2
```

### 查看服务日志

```bash
# 实时日志
docker logs -f deepseek-ocr-gpu

# 最近 50 行
docker logs --tail 50 deepseek-ocr-gpu

# 搜索关键词
docker logs deepseek-ocr-gpu 2>&1 | grep "GPU\|offload\|load"
```

---

## 🛠️ 管理命令

### 服务管理

```bash
# 启动服务
./start_gpu.sh

# 停止服务
docker compose -f docker-compose.gpu.yml down

# 重启服务
docker compose -f docker-compose.gpu.yml restart

# 查看状态
docker ps | grep deepseek-ocr-gpu
```

### GPU 管理

```bash
# 手动卸载 GPU
curl -X POST http://localhost:8001/gpu/offload

# 完全释放资源
curl -X POST http://localhost:8001/gpu/release

# 查看 GPU 状态
curl http://localhost:8001/gpu/status
```

---

## 🐛 故障排查

### 问题1: 端口被占用

**症状**：`address already in use`

**解决**：
```bash
# 查找占用进程
sudo lsof -i :8001

# 停止进程
kill <PID>

# 重新启动
./start_gpu.sh
```

### 问题2: GPU 未识别

**症状**：`backend: cpu`

**解决**：
```bash
# 检查 NVIDIA 驱动
nvidia-smi

# 检查 Docker GPU 支持
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# 重启 Docker
sudo systemctl restart docker
```

### 问题3: 显存未释放

**症状**：GPU 显存持续占用

**解决**：
```bash
# 手动卸载
curl -X POST http://localhost:8001/gpu/offload

# 完全释放
curl -X POST http://localhost:8001/gpu/release

# 重启容器
docker restart deepseek-ocr-gpu
```

---

## 📚 相关文档

- [GPU 管理详细文档](./GPU_MANAGEMENT.md)
- [完整 README](./README.md)
- [部署总结](./DEPLOYMENT_SUMMARY.md)

---

## 🎯 最佳实践

### 生产环境

```bash
# 1. 设置较长的超时时间
GPU_IDLE_TIMEOUT=300

# 2. 启用健康检查
docker compose -f docker-compose.gpu.yml up -d

# 3. 配置监控告警
# 监控 GPU 显存占用，超过阈值时告警
```

### 开发环境

```bash
# 1. 设置较短的超时时间
GPU_IDLE_TIMEOUT=30

# 2. 查看实时日志
docker logs -f deepseek-ocr-gpu

# 3. 监控 GPU 状态
watch -n 1 nvidia-smi
```

### 多 GPU 环境

```bash
# 方法1: 手动指定 GPU
NVIDIA_VISIBLE_DEVICES=1 ./start_gpu.sh

# 方法2: 修改 .env
echo "NVIDIA_VISIBLE_DEVICES=1" > .env
docker compose -f docker-compose.gpu.yml up -d

# 方法3: 运行多个实例（不同端口）
PORT=8002 NVIDIA_VISIBLE_DEVICES=1 docker compose -f docker-compose.gpu.yml up -d
```

---

**Made with ❤️ by DeepSeek-OCR Team**
