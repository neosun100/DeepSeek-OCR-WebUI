# 🔍 DeepSeek-OCR-WebUI v4.0

> 🎉 **NEW**: Multi-Platform Support! Now runs on Mac (Apple Silicon) and Linux (NVIDIA GPU)

<div align="center">

**🌐 [English](./README.md) | [简体中文](./README_zh-CN.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md)**

[![Version](https://img.shields.io/badge/version-v4.0-blue.svg)](./CHANGELOG.md)
[![Docker](https://img.shields.io/badge/docker-supported-brightgreen.svg)](./docker-compose.yml)
[![Mac](https://img.shields.io/badge/mac-apple%20silicon-orange.svg)](./QUICKSTART_MAC.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Intelligent OCR System · Multi-Platform · Batch Processing · Bounding Box Visualization

[Features](#features) • [Quick Start](#quick-start) • [Platforms](#platforms) • [Documentation](#documentation)

</div>

---

## 🆕 What's New in v4.0

### 🍎 Mac Support (Apple Silicon)
- ✅ **MLX Backend** - Optimized for M1/M2/M3/M4 chips
- ✅ **Metal GPU** - Hardware acceleration
- ✅ **8-bit Model** - Lower memory usage (~4GB)
- ✅ **Native Performance** - 2-4 seconds per image

### 🤖 Smart Platform Detection
- ✅ **Auto-detect** - Automatically chooses best backend
- ✅ **Unified API** - Same interface across platforms
- ✅ **Conda Isolation** - Clean virtual environments

### 🔄 Backward Compatible
- ✅ **Original Features** - All existing functionality preserved
- ✅ **Same API** - No breaking changes
- ✅ **Docker Support** - Still works on Linux

---

## 🎯 Supported Platforms

| Platform | Backend | Model | Acceleration | Status |
|----------|---------|-------|--------------|--------|
| 🍎 **Mac (Apple Silicon)** | MLX | 8-bit quantized | Metal GPU | ✅ Ready |
| 🐧 **Linux + NVIDIA GPU** | CUDA | bfloat16 | CUDA GPU | ✅ Ready |
| 🪟 **Windows + NVIDIA GPU** | CUDA | bfloat16 | CUDA GPU | ⚠️ Experimental |

---

## 🚀 Quick Start

### 🍎 Mac (Apple Silicon)

```bash
# One-line start
./run_mac.sh

# Or use smart launcher
./start.sh
```

**Requirements:**
- macOS 12.0+
- Apple Silicon (M1/M2/M3/M4)
- Conda or Miniconda
- 8GB+ RAM

📖 [Mac Quick Start Guide](./QUICKSTART_MAC.md)

### 🐧 Linux (NVIDIA GPU)

```bash
# Docker (recommended)
docker compose up -d

# Or smart launcher
./start.sh
```

**Requirements:**
- Docker + Docker Compose
- NVIDIA GPU + Drivers
- nvidia-docker2
- 8GB+ RAM

📖 [Original Quick Start](./README.md#quick-start)

---

## 📦 Installation

### Mac Installation

```bash
# 1. Clone repository
git clone https://github.com/neosun100/DeepSeek-OCR-WebUI.git
cd DeepSeek-OCR-WebUI

# 2. Run (auto-setup)
./run_mac.sh

# 3. Access
open http://localhost:8001
```

### Linux Installation

```bash
# 1. Clone repository
git clone https://github.com/neosun100/DeepSeek-OCR-WebUI.git
cd DeepSeek-OCR-WebUI

# 2. Start Docker
docker compose up -d

# 3. Check logs
docker logs -f deepseek-ocr-webui
```

---

## ✨ Features

All original features are preserved:

- 🎯 **7 Recognition Modes** - Document, OCR, Chart, Find, Freeform, etc.
- 🖼️ **Bounding Box Visualization** - Auto-annotate positions
- 📦 **Batch Processing** - Multiple images
- 📄 **PDF Support** - Auto-convert to images
- 🎨 **Modern UI** - Gradient backgrounds
- 🌐 **Multilingual** - 4 languages
- 🐳 **Docker Ready** - One-click deployment

**Plus new features:**
- 🍎 **Mac Support** - Native Apple Silicon
- 🤖 **Auto-detect** - Smart platform selection
- 📦 **Conda Isolation** - Clean environments

---

## 📊 Performance Comparison

| Platform | Backend | Speed | Memory | Recommendation |
|----------|---------|-------|--------|----------------|
| Mac M3 Max | MLX | ~2-3s | ~4GB | ⚡ Native |
| Mac M2 Pro | MLX | ~3-4s | ~4GB | ⚡ Native |
| RTX 4090 | CUDA | ~1-2s | ~8GB | 🐳 Docker |
| RTX 3090 | CUDA | ~2-3s | ~8GB | 🐳 Docker |

---

## 🏗️ Architecture

```
DeepSeek-OCR-WebUI/
├── web_service_unified.py      # Unified entry (auto-detect)
├── backends/
│   ├── mlx_backend.py          # Apple Silicon
│   └── cuda_backend.py         # NVIDIA GPU
├── start.sh                    # Smart launcher
├── run_mac.sh                  # Mac launcher
└── test_mlx.py                 # Test script
```

---

## 🧪 Testing

### Test Your Installation

```bash
# Activate environment
conda activate deepseek-ocr-mlx

# Run tests
python test_mlx.py

# Full test (includes model loading)
python test_mlx.py --full
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

## 📚 Documentation

### User Guides
- 📘 [Mac Quick Start](./QUICKSTART_MAC.md) - **NEW**
- 📗 [Multi-Platform Guide](./README_MULTIPLATFORM.md) - **NEW**
- 📙 [Original Quick Start](./QUICK_START.md)
- 📕 [Find Mode Guide](./FIND_MODE_V2_GUIDE.md)

### Technical Docs
- 🔧 [Implementation Summary](./IMPLEMENTATION_SUMMARY.md) - **NEW**
- 📝 [Deployment Guide](./DEPLOYMENT_SUMMARY.md)
- 🌐 [I18n Implementation](./I18N_IMPLEMENTATION.md)

---

## 🔄 Migration Guide

### From v3.x to v4.0

**No breaking changes!** All v3.x features work as before.

**New options:**
```bash
# Mac users can now use
./run_mac.sh

# All users can use smart launcher
./start.sh

# Original methods still work
docker compose up -d  # Linux
python web_service.py  # Direct
```

---

## 🐛 Troubleshooting

### Mac Issues

**MLX not found:**
```bash
conda activate deepseek-ocr-mlx
pip install mlx mlx-vlm
```

**Model download slow:**
```bash
export HF_ENDPOINT=https://hf-mirror.com
```

### Linux Issues

**GPU not detected:**
```bash
nvidia-smi
sudo apt-get install nvidia-docker2
```

**Port conflict:**
```bash
PORT=8002 python web_service_unified.py
```

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
- All contributors and users

---

## 🔗 Quick Links

- 🏠 [Project Home](https://github.com/neosun100/DeepSeek-OCR-WebUI)
- 📖 [Full Documentation](https://github.com/neosun100/DeepSeek-OCR-WebUI/wiki)
- 🐛 [Issue Tracker](https://github.com/neosun100/DeepSeek-OCR-WebUI/issues)
- 💬 [Discussions](https://github.com/neosun100/DeepSeek-OCR-WebUI/discussions)

---

<div align="center">

**⭐ If this project helps you, please give it a Star! ⭐**

Made with ❤️ for multi-platform AI

DeepSeek-OCR-WebUI v4.0 | © 2025

</div>
