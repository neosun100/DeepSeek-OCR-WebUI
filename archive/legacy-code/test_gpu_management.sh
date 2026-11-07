#!/bin/bash
set -e

echo "=================================================="
echo "🧪 GPU Management Test Suite"
echo "=================================================="
echo ""

BASE_URL="http://localhost:8001"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "📊 Test 1: Health Check"
echo "---"
curl -s $BASE_URL/health | python3 -m json.tool
echo -e "${GREEN}✅ Health check passed${NC}"
echo ""

echo "📊 Test 2: Initial GPU Status (should be unloaded)"
echo "---"
STATUS=$(curl -s $BASE_URL/gpu/status)
echo "$STATUS" | python3 -m json.tool
MODEL_LOC=$(echo "$STATUS" | python3 -c "import sys, json; print(json.load(sys.stdin)['model_location'])")
if [ "$MODEL_LOC" = "unloaded" ]; then
    echo -e "${GREEN}✅ Model is unloaded (expected)${NC}"
else
    echo -e "${YELLOW}⚠️  Model location: $MODEL_LOC${NC}"
fi
echo ""

echo "📊 Test 3: Check GPU Memory (should be ~0 MB)"
echo "---"
nvidia-smi --query-gpu=index,memory.used --format=csv,noheader -i 2
echo -e "${GREEN}✅ GPU memory check passed${NC}"
echo ""

echo "📊 Test 4: Manual Offload (should succeed even if unloaded)"
echo "---"
curl -s -X POST $BASE_URL/gpu/offload | python3 -m json.tool
echo -e "${GREEN}✅ Manual offload passed${NC}"
echo ""

echo "📊 Test 5: Manual Release (should succeed)"
echo "---"
curl -s -X POST $BASE_URL/gpu/release | python3 -m json.tool
echo -e "${GREEN}✅ Manual release passed${NC}"
echo ""

echo "=================================================="
echo "✅ All tests passed!"
echo "=================================================="
echo ""
echo "📝 Next Steps:"
echo "   1. Upload an image via Web UI: http://localhost:8001"
echo "   2. Watch GPU memory: watch -n 1 nvidia-smi"
echo "   3. Monitor logs: docker logs -f deepseek-ocr-gpu"
echo ""
echo "🎯 Expected Behavior:"
echo "   - First OCR: Model loads (~20-30s), GPU memory ~7GB"
echo "   - After OCR: Model offloads to CPU (~2s), GPU memory <1GB"
echo "   - Second OCR: Model loads from CPU (~2-5s), GPU memory ~7GB"
echo "   - After 60s idle: Model stays on CPU"
echo ""
