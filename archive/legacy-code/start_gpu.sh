#!/bin/bash
set -e

echo "=================================================="
echo "🚀 DeepSeek-OCR with GPU Management"
echo "=================================================="

# 检查 nvidia-docker
if ! command -v nvidia-smi &> /dev/null; then
    echo "❌ nvidia-smi not found. Please install NVIDIA drivers."
    exit 1
fi

if ! docker info | grep -q "Runtimes.*nvidia"; then
    echo "❌ nvidia-docker runtime not found. Please install nvidia-docker2."
    exit 1
fi

echo "✅ NVIDIA Docker environment OK"
echo ""

# 自动选择显存占用最少的 GPU
echo "🔍 Detecting available GPUs..."
nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader

GPU_ID=$(nvidia-smi --query-gpu=index,memory.used --format=csv,noheader,nounits | \
         sort -t',' -k2 -n | head -1 | cut -d',' -f1)

GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader -i $GPU_ID)
GPU_MEM_USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -i $GPU_ID)
GPU_MEM_TOTAL=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits -i $GPU_ID)

echo ""
echo "✅ Selected GPU $GPU_ID: $GPU_NAME"
echo "   Memory: ${GPU_MEM_USED}MB / ${GPU_MEM_TOTAL}MB used"
echo ""

# 设置环境变量
export NVIDIA_VISIBLE_DEVICES=$GPU_ID

# 创建 .env 文件
cat > .env << EOF
PORT=8001
NVIDIA_VISIBLE_DEVICES=$GPU_ID
GPU_IDLE_TIMEOUT=60
EOF

echo "📝 Created .env file:"
cat .env
echo ""

# 启动服务
echo "🚀 Starting service..."
docker compose -f docker-compose.gpu.yml up -d

echo ""
echo "=================================================="
echo "✅ Service started successfully!"
echo "=================================================="
echo ""
echo "📍 Access URLs:"
echo "   - Local:  http://localhost:8001"
echo "   - Remote: http://$(hostname -I | awk '{print $1}'):8001"
echo ""
echo "📊 GPU Status:"
echo "   - Selected GPU: $GPU_ID ($GPU_NAME)"
echo "   - Idle Timeout: 60 seconds"
echo ""
echo "🔧 Management Commands:"
echo "   - View logs:    docker logs -f deepseek-ocr-gpu"
echo "   - Stop service: docker compose -f docker-compose.gpu.yml down"
echo "   - GPU status:   curl http://localhost:8001/gpu/status"
echo "   - Offload GPU:  curl -X POST http://localhost:8001/gpu/offload"
echo ""
echo "=================================================="
