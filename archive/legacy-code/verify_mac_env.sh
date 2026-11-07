#!/bin/bash

echo "======================================"
echo "🔍 Verifying Mac Environment"
echo "======================================"
echo ""

# Check if conda environment is activated
if [ -z "$CONDA_DEFAULT_ENV" ]; then
    echo "❌ Error: No conda environment activated"
    echo "   Please run: conda activate deepseek-ocr-mlx"
    exit 1
fi

echo "✅ Conda environment: $CONDA_DEFAULT_ENV"
echo ""

# Check Python version
PYTHON_VERSION=$(python --version 2>&1)
echo "🐍 $PYTHON_VERSION"
echo ""

# Check required packages
echo "📦 Checking required packages..."
echo ""

PACKAGES=(
    "torch"
    "torchvision"
    "transformers"
    "tokenizers"
    "fastapi"
    "uvicorn"
    "fitz"
    "PIL"
    "einops"
    "addict"
    "easydict"
    "matplotlib"
    "numpy"
)

ALL_OK=true

for package in "${PACKAGES[@]}"; do
    if python -c "import $package" 2>/dev/null; then
        VERSION=$(python -c "import $package; print($package.__version__)" 2>/dev/null || echo "N/A")
        echo "  ✅ $package ($VERSION)"
    else
        echo "  ❌ $package - NOT INSTALLED"
        ALL_OK=false
    fi
done

echo ""

# Check MPS availability
echo "🍎 Checking MPS (Metal Performance Shaders)..."
MPS_CHECK=$(python -c "import torch; print('available' if torch.backends.mps.is_available() else 'not available')" 2>/dev/null)
if [ "$MPS_CHECK" = "available" ]; then
    echo "  ✅ MPS is available"
else
    echo "  ❌ MPS is not available"
    ALL_OK=false
fi

echo ""
echo "======================================"

if [ "$ALL_OK" = true ]; then
    echo "✅ Environment verification passed!"
    echo "   You can now run: ./start.sh"
else
    echo "❌ Environment verification failed!"
    echo "   Please install missing packages:"
    echo "   pip install -r requirements-mac.txt"
fi

echo "======================================"
