#!/bin/bash
# Universal startup script for DeepSeek-OCR-WebUI
# Works on Mac (MPS), Linux (CUDA/CPU), and Docker

set -e

echo "=========================================="
echo "🚀 DeepSeek-OCR-WebUI Startup"
echo "=========================================="

# Detect environment
if [ -f /.dockerenv ]; then
    echo "📦 Running in Docker"
    BACKEND="cuda"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 Running on macOS"
    if [[ $(uname -m) == "arm64" ]]; then
        echo "   Apple Silicon detected"
        BACKEND="mps"
    else
        echo "   Intel Mac detected"
        BACKEND="cpu"
    fi
elif command -v nvidia-smi &> /dev/null; then
    echo "🐧 Running on Linux with NVIDIA GPU"
    BACKEND="cuda"
else
    echo "🐧 Running on Linux without GPU"
    BACKEND="cpu"
fi

echo "   Selected backend: $BACKEND"
echo "=========================================="

# Set environment
export FORCE_BACKEND=$BACKEND

# Check if conda environment exists
if command -v conda &> /dev/null; then
    if conda env list | grep -q "deepseek-ocr-mlx"; then
        echo "✅ Using conda environment: deepseek-ocr-mlx"
        conda run -n deepseek-ocr-mlx python web_service_unified.py
    else
        echo "⚠️  Conda environment 'deepseek-ocr-mlx' not found"
        echo "   Running with system Python"
        python web_service_unified.py
    fi
else
    echo "✅ Running with system Python"
    python web_service_unified.py
fi
