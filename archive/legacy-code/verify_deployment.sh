#!/bin/bash
# DeepSeek-OCR 部署验证脚本

echo "=========================================="
echo "🔍 DeepSeek-OCR 部署验证"
echo "=========================================="
echo ""

# 1. 检查 Docker 容器
echo "1️⃣  检查 Docker 容器状态..."
if docker ps | grep -q "deepseek-ocr-webui"; then
    echo "✅ Docker 容器正在运行"
    docker ps --filter "name=deepseek-ocr" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
else
    echo "❌ Docker 容器未运行"
    echo "   请运行: docker compose up -d"
    exit 1
fi
echo ""

# 2. 检查健康状态
echo "2️⃣  检查服务健康状态..."
HEALTH=$(curl -s http://localhost:8001/health)
if [ $? -eq 0 ]; then
    echo "✅ 服务健康检查通过"
    echo "$HEALTH" | jq '.'
else
    echo "❌ 服务健康检查失败"
    exit 1
fi
echo ""

# 3. 检查文件
echo "3️⃣  检查关键文件..."
FILES=(
    "Dockerfile"
    "docker-compose.yml"
    "web_service_gpu.py"
    "gpu_manager.py"
    "backends/cuda_backend.py"
    "mcp_server.py"
    "API.md"
    "MCP_SETUP.md"
    "test_api.py"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file (缺失)"
    fi
done
echo ""

# 4. 检查端口
echo "4️⃣  检查端口监听..."
if netstat -tuln 2>/dev/null | grep -q ":8001" || ss -tuln 2>/dev/null | grep -q ":8001"; then
    echo "✅ 端口 8001 正在监听"
else
    echo "⚠️  端口 8001 未监听（可能正在启动）"
fi
echo ""

# 5. 显示访问信息
echo "=========================================="
echo "📍 访问信息"
echo "=========================================="
echo "Web UI:  http://localhost:8001"
echo "API:     http://localhost:8001/ocr"
echo "Health:  http://localhost:8001/health"
echo "Docs:    http://localhost:8001/docs"
echo ""

# 6. 显示日志
echo "=========================================="
echo "📋 最近日志 (最后 10 行)"
echo "=========================================="
docker logs --tail 10 deepseek-ocr-webui-original 2>&1 | grep -v "GET /health"
echo ""

echo "=========================================="
echo "✅ 验证完成！"
echo "=========================================="
echo ""
echo "💡 提示:"
echo "   - 首次 OCR 识别需要加载模型（约 1 分钟）"
echo "   - 单张图片识别需要 3-5 分钟"
echo "   - 查看完整文档: cat COMPLETE_SETUP.md"
echo ""
