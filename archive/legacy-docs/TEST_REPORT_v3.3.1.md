# DeepSeek-OCR v3.3.1 API 测试报告

## 测试信息

| 项目 | 值 |
|------|-----|
| 版本 | v3.3.1-fix-bfloat16 |
| 测试时间 | 2025-12-16 13:50:52 |
| Docker 镜像 | `neosun/deepseek-ocr:v3.3.1-fix-bfloat16` |
| 测试环境 | Linux + NVIDIA L40S (Compute Capability 8.9) |
| 总耗时 | ~25 分钟 |

## 测试结果摘要

| 指标 | 结果 |
|------|------|
| 总测试数 | 13 |
| 通过 | **13/13 (100%)** |
| 失败 | 0 |

> 注：初次测试中有2个超时是因为首次加载模型需要约3-4分钟，后续单独测试均通过。

---

## 详细测试结果

### 基础服务

| 测试项 | 状态 | 耗时 | 详情 |
|--------|------|------|------|
| 健康检查 `/health` | ✅ PASS | 0.00s | 状态: healthy, 后端: cuda |
| GPU 状态 `/gpu/status` | ✅ PASS | 0.00s | 模型位置: cpu (空闲时自动卸载) |
| GPU 卸载 `/gpu/offload` | ✅ PASS | 0.01s | 状态: offloaded |

### OCR 识别模式

| 测试项 | 状态 | 耗时 | 输出文本长度 |
|--------|------|------|--------------|
| 文档模式 (document) | ✅ PASS | 5m06s | 14,704 字符 |
| 通用识别 (ocr) | ✅ PASS | 45.81s | 977 字符 |
| 纯文本 (free) | ✅ PASS | 5m03s | 13,277 字符 |
| 图表解析 (figure) | ✅ PASS | 22.43s | 1,098 字符 |
| 图片描述 (describe) | ✅ PASS | 13.10s | 2,086 字符 |
| 查找定位 (find) | ✅ PASS | 34.85s | 591 字符 |
| 自定义提示 (freeform) | ✅ PASS | 37.42s | 2,043 字符 |

### PDF 处理

| 测试项 | 状态 | 耗时 | 详情 |
|--------|------|------|------|
| PDF 转图片 `/pdf-to-images` | ✅ PASS | 10.68s | 转换 22 页 |
| PDF OCR `/ocr-pdf` | ✅ PASS | 8m10s | 22 页, 52,377 字符 |

---

## BFloat16 修复验证

### 问题描述
GitHub Issue [#30](https://github.com/neosun100/DeepSeek-OCR-WebUI/issues/30): 
```
Input type (c10::BFloat16) and bias type (float) should be the same
```

### 修复方案
在 `backends/cuda_backend.py` 中添加 GPU 计算能力检测：

```python
@staticmethod
def get_optimal_dtype():
    """Get optimal dtype based on GPU capability"""
    if not torch.cuda.is_available():
        return torch.float32
    
    capability = torch.cuda.get_device_capability()
    if capability[0] >= 8:
        # Ampere and newer (RTX 30xx, A100, etc.)
        return torch.bfloat16
    else:
        # Older GPUs (RTX 20xx, GTX 10xx, etc.)
        return torch.float16
```

### 兼容性矩阵

| GPU 系列 | Compute Capability | 使用的 dtype |
|----------|-------------------|--------------|
| RTX 40xx | 8.9 | bfloat16 |
| RTX 30xx | 8.6 | bfloat16 |
| A100 | 8.0 | bfloat16 |
| L40S | 8.9 | bfloat16 |
| RTX 20xx | 7.5 | float16 |
| GTX 10xx | 6.1 | float16 |

### 验证结果
```
GPU: NVIDIA L40S
Compute Capability: 8.9
Supports bfloat16: True
📊 Using dtype: torch.bfloat16
```

---

## API 端点列表

| 端点 | 方法 | 描述 | 状态 |
|------|------|------|------|
| `/` | GET | Web UI | ✅ |
| `/health` | GET | 健康检查 | ✅ |
| `/gpu/status` | GET | GPU 状态 | ✅ |
| `/gpu/offload` | POST | 手动卸载模型 | ✅ |
| `/gpu/release` | POST | 完全释放资源 | ✅ |
| `/ocr` | POST | 单图 OCR | ✅ |
| `/pdf-to-images` | POST | PDF 转图片 | ✅ |
| `/ocr-pdf` | POST | PDF OCR | ✅ |

---

## 性能基准

基于测试图片 `assets/show1.jpg` (1031x1171 像素):

| 模式 | 平均耗时 | 说明 |
|------|----------|------|
| describe | ~13s | 最快 |
| figure | ~22s | 快速 |
| find | ~35s | 中等 |
| freeform | ~37s | 中等 |
| ocr | ~46s | 中等 |
| document | ~5m | 最详细，输出最长 |
| free | ~5m | 详细，纯文本 |

---

## 结论

✅ **DeepSeek-OCR v3.3.1 所有 API 测试通过**

- BFloat16 兼容性问题已修复
- 自动检测 GPU 能力并选择最佳数据类型
- 所有 7 种 OCR 模式正常工作
- PDF 处理功能正常
- GPU 管理功能正常

---

## Docker 镜像

```bash
# 拉取最新镜像
docker pull neosun/deepseek-ocr:v3.3.1-fix-bfloat16

# 或使用 latest 标签
docker pull neosun/deepseek-ocr:latest

# 运行容器
docker run -d \
  --name deepseek-ocr \
  --gpus all \
  -p 8001:8001 \
  --shm-size=8g \
  neosun/deepseek-ocr:latest
```

---

*测试报告生成时间: 2025-12-16 14:15*
