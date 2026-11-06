# 🌐 Multi-Platform Support Guide

DeepSeek-OCR-WebUI now supports multiple platforms with automatic backend selection!

## 🎯 Supported Platforms

| Platform | Backend | Acceleration | Status |
|----------|---------|--------------|--------|
| 🍎 **Mac (Apple Silicon)** | MLX | Metal GPU | ✅ Optimized |
| 🐧 **Linux + NVIDIA GPU** | CUDA | CUDA GPU | ✅ Optimized |
| 🪟 **Windows + NVIDIA GPU** | CUDA | CUDA GPU | ⚠️ Experimental |

---

## 🚀 Quick Start

### Option 1: Smart Launcher (Recommended)

```bash
# Auto-detects platform and starts appropriate service
./start.sh
```

The smart launcher will:
- ✅ Detect your platform (Mac/Linux/Windows)
- ✅ Check for GPU availability
- ✅ Choose optimal backend (MLX/CUDA)
- ✅ Start service with best configuration

### Option 2: Platform-Specific

#### 🍎 Mac (Apple Silicon)

**Native (Best Performance):**
```bash
./run_mac.sh
```

**Docker (Testing Only):**
```bash
export DOCKERFILE=Dockerfile.mlx
docker compose -f docker-compose-unified.yml up -d
```

> ⚠️ **Note**: Docker on Mac doesn't support MLX acceleration. Use native mode for best performance.

#### 🐧 Linux (NVIDIA GPU)

```bash
# Using original docker-compose
docker compose up -d

# Or using unified version
export DOCKERFILE=Dockerfile
docker compose -f docker-compose-unified.yml up -d
```

---

## 📦 Installation

### Mac (Apple Silicon)

```bash
# 1. Clone repository
git clone https://github.com/neosun100/DeepSeek-OCR-WebUI.git
cd DeepSeek-OCR-WebUI

# 2. Install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-mlx.txt

# 3. Run
./run_mac.sh
```

**Requirements:**
- macOS 12.0+ (Monterey or later)
- Apple Silicon (M1/M2/M3/M4)
- Python 3.9+
- 8GB+ RAM

### Linux (NVIDIA GPU)

```bash
# 1. Clone repository
git clone https://github.com/neosun100/DeepSeek-OCR-WebUI.git
cd DeepSeek-OCR-WebUI

# 2. Start with Docker
docker compose up -d

# 3. Check logs
docker logs -f deepseek-ocr-webui
```

**Requirements:**
- Docker + Docker Compose
- NVIDIA GPU + Drivers
- nvidia-docker2
- 8GB+ RAM
- 20GB+ Disk

---

## 🏗️ Architecture

```
DeepSeek-OCR-WebUI/
├── web_service_unified.py      # Unified entry point (auto-detect)
├── backends/
│   ├── mlx_backend.py          # Apple Silicon (MLX)
│   └── cuda_backend.py         # NVIDIA GPU (CUDA)
├── Dockerfile                  # CUDA version
├── Dockerfile.mlx              # MLX version
├── docker-compose.yml          # Original (CUDA)
├── docker-compose-unified.yml  # Multi-platform
├── start.sh                    # Smart launcher
├── run_mac.sh                  # Mac native launcher
├── requirements.txt            # CUDA dependencies
└── requirements-mlx.txt        # MLX dependencies
```

---

## 🔧 Backend Details

### MLX Backend (Mac)

**Model:** `mlx-community/DeepSeek-OCR-8bit`

**Features:**
- ✅ Optimized for Apple Silicon
- ✅ Metal GPU acceleration
- ✅ 8-bit quantization (lower memory)
- ✅ Fast inference on M-series chips

**Usage:**
```python
from backends.mlx_backend import MLXBackend

backend = MLXBackend()
backend.load_model()
result = backend.infer(prompt="OCR this image", image_path="test.png")
```

### CUDA Backend (Linux/Windows)

**Model:** `deepseek-ai/DeepSeek-OCR`

**Features:**
- ✅ Full precision (bfloat16)
- ✅ CUDA GPU acceleration
- ✅ Supports HuggingFace & ModelScope
- ✅ Auto-fallback on network issues

**Usage:**
```python
from backends.cuda_backend import CUDABackend

backend = CUDABackend()
backend.load_model(source="huggingface")
result = backend.infer(prompt="OCR this image", image_path="test.png")
```

---

## 🧪 Testing

### Test Platform Detection

```bash
python3 -c "
from web_service_unified import detect_platform
print(f'Detected backend: {detect_platform()}')
"
```

### Test Backend

**Mac (MLX):**
```bash
python3 -c "
from backends.mlx_backend import MLXBackend
print(f'MLX available: {MLXBackend.is_available()}')
"
```

**Linux (CUDA):**
```bash
python3 -c "
from backends.cuda_backend import CUDABackend
print(f'CUDA available: {CUDABackend.is_available()}')
"
```

### Test API

```bash
# Health check
curl http://localhost:8001/health

# OCR test
curl -X POST http://localhost:8001/ocr \
  -F "file=@test.png" \
  -F "prompt_type=ocr"
```

---

## 📊 Performance Comparison

| Platform | Backend | Model Size | Inference Speed | Memory Usage |
|----------|---------|------------|-----------------|--------------|
| Mac M3 Max | MLX | 8-bit | ~2-3s/image | ~4GB |
| Mac M2 Pro | MLX | 8-bit | ~3-4s/image | ~4GB |
| RTX 4090 | CUDA | bf16 | ~1-2s/image | ~8GB |
| RTX 3090 | CUDA | bf16 | ~2-3s/image | ~8GB |

> ⚡ Performance varies based on image size and complexity

---

## 🐛 Troubleshooting

### Mac Issues

**MLX not found:**
```bash
pip install mlx mlx-vlm
```

**Model download slow:**
```bash
# Use HuggingFace mirror
export HF_ENDPOINT=https://hf-mirror.com
```

**Permission denied:**
```bash
chmod +x run_mac.sh start.sh
```

### Linux Issues

**NVIDIA GPU not detected:**
```bash
# Check GPU
nvidia-smi

# Install nvidia-docker2
sudo apt-get install nvidia-docker2
sudo systemctl restart docker
```

**Model loading timeout:**
- The system will auto-switch to ModelScope
- Or manually set: `export MODEL_SOURCE=modelscope`

---

## 🔄 Migration Guide

### From Original Version

If you're using the original CUDA-only version:

1. **Keep existing setup** - Original files still work
2. **Try unified version** - Use `web_service_unified.py`
3. **No breaking changes** - API remains compatible

### Switching Backends

```bash
# Force MLX (Mac only)
export FORCE_BACKEND=mlx
python3 web_service_unified.py

# Force CUDA (Linux only)
export FORCE_BACKEND=cuda
python3 web_service_unified.py
```

---

## 📝 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKERFILE` | Dockerfile to use | `Dockerfile` |
| `PLATFORM` | Platform identifier | Auto-detect |
| `GPU_DRIVER` | GPU driver type | `nvidia` |
| `GPU_COUNT` | Number of GPUs | `1` |
| `MEM_LIMIT` | Memory limit | `32g` |
| `PORT` | Service port | `8001` |
| `FORCE_BACKEND` | Force backend type | Auto-detect |

---

## 🤝 Contributing

We welcome contributions for:
- 🪟 Windows native support
- 🎮 AMD GPU support (ROCm)
- ⚡ Performance optimizations
- 🐛 Bug fixes

---

## 📄 License

MIT License - See [LICENSE](./LICENSE)

---

## 🙏 Acknowledgments

- [DeepSeek-AI](https://github.com/deepseek-ai) - Original model
- [MLX Community](https://huggingface.co/mlx-community) - MLX conversion
- [Apple MLX](https://github.com/ml-explore/mlx) - MLX framework

---

<div align="center">

**⭐ Star us on GitHub! ⭐**

Made with ❤️ for multi-platform AI

</div>
