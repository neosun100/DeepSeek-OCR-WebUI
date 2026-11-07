# DeepSeek-OCR API Documentation

完整的 API 使用指南，包含详细示例、最佳实践和性能优化建议。

## 📋 目录
- [快速开始](#快速开始)
- [API 端点](#api-端点)
- [详细示例](#详细示例)
- [客户端集成](#客户端集成)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

## 快速开始

### Base URL
```
http://localhost:8001
```

### Docker 快速启动
```bash
# CPU 版本
docker run -d -p 8001:8001 neosun/deepseek-ocr-webui:latest

# GPU 版本（推荐）
docker run -d --gpus all -p 8001:8001 neosun/deepseek-ocr-webui:gpu
```

### 健康检查
```bash
curl http://localhost:8001/health
```

---

## API 端点

### 1. Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "backend": "cuda",
  "platform": "Linux",
  "model_loaded": true
}
```

### 2. OCR Recognition (Single Image)
```http
POST /ocr
Content-Type: multipart/form-data
```

**Parameters:**
- `file` (required): Image file (PNG, JPG, JPEG)
- `mode` (optional): Recognition mode
  - `doc` - Document to Markdown (default)
  - `ocr` - General OCR
  - `plain` - Plain text
  - `chart` - Chart parser
  - `image` - Image description
  - `find` - Find & locate
  - `custom` - Custom prompt
- `search_text` (optional): Search text for `find` mode
- `custom_prompt` (optional): Custom prompt for `custom` mode

**Response:**
```json
{
  "text": "Recognized text...",
  "bboxes": [
    {"text": "found text", "bbox": [x1, y1, x2, y2]}
  ],
  "image_base64": "data:image/png;base64,..."
}
```

### 3. PDF OCR (All Pages) ⭐ NEW
```http
POST /ocr-pdf
Content-Type: multipart/form-data
```

**Parameters:**
- `file` (required): PDF file
- `prompt_type` (optional): Recognition mode (same as `/ocr`)
- `find_term` (optional): Search text for find mode
- `custom_prompt` (optional): Custom prompt

**Response:**
```json
{
  "success": true,
  "filename": "document.pdf",
  "page_count": 5,
  "pages": [
    {
      "page": 1,
      "text": "Page 1 content...",
      "raw_text": "..."
    },
    {
      "page": 2,
      "text": "Page 2 content...",
      "raw_text": "..."
    }
  ],
  "merged_text": "--- Page 1 ---\nContent...\n--- Page 2 ---\nContent...",
  "metadata": {
    "mode": "document",
    "backend": "cuda"
  }
}
```

### 4. PDF to Images
```http
POST /pdf-to-images
Content-Type: multipart/form-data
```

**Parameters:**
- `file` (required): PDF file

**Response:**
```json
{
  "success": true,
  "images": [
    {
      "data": "data:image/png;base64,...",
      "name": "page_1.png",
      "width": 1200,
      "height": 1600,
      "page_number": 1
    }
  ],
  "page_count": 5
}
```

## Python Client Example

```python
import requests
import base64

# Simple OCR (single image)
with open("image.png", "rb") as f:
    response = requests.post(
        "http://localhost:8001/ocr",
        files={"file": f},
        data={"mode": "ocr"}
    )
    result = response.json()
    print(result["text"])

# PDF OCR (all pages) ⭐ NEW
with open("document.pdf", "rb") as f:
    response = requests.post(
        "http://localhost:8001/ocr-pdf",
        files={"file": f},
        data={"prompt_type": "document"},
        timeout=600  # PDF processing takes longer
    )
    result = response.json()
    
    # Get merged text from all pages
    print(result["merged_text"])
    
    # Or process each page separately
    for page in result["pages"]:
        print(f"Page {page['page']}: {page['text'][:100]}...")

# Find mode with search
with open("invoice.png", "rb") as f:
    response = requests.post(
        "http://localhost:8001/ocr",
        files={"file": f},
        data={"mode": "find", "search_text": "Total"}
    )
    result = response.json()
    for bbox in result.get("bboxes", []):
        print(f"Found: {bbox['text']} at {bbox['bbox']}")
```

## cURL Examples

```bash
# Health check
curl http://localhost:8001/health

# Simple OCR (single image)
curl -X POST http://localhost:8001/ocr \
  -F "file=@image.png" \
  -F "mode=ocr"

# PDF OCR (all pages) ⭐ NEW
curl -X POST http://localhost:8001/ocr-pdf \
  -F "file=@document.pdf" \
  -F "prompt_type=document" \
  --max-time 600

# Find mode
curl -X POST http://localhost:8001/ocr \
  -F "file=@invoice.png" \
  -F "mode=find" \
  -F "search_text=Total"

# Custom prompt
curl -X POST http://localhost:8001/ocr \
  -F "file=@document.png" \
  -F "mode=custom" \
  -F "custom_prompt=Extract all dates and amounts"
```

## Error Responses

```json
{
  "detail": "Error message"
}
```

Status codes:
- `200` - Success
- `400` - Bad request
- `500` - Server error

---

## 详细示例

### 场景 1: 发票数据提取

**使用 Find 模式定位关键信息：**

```python
import requests

def extract_invoice_data(image_path):
    """提取发票关键信息"""

    # 需要查找的关键字段
    fields = ["Total", "Invoice Number", "Date", "Tax"]
    results = {}

    for field in fields:
        with open(image_path, "rb") as f:
            response = requests.post(
                "http://localhost:8001/ocr",
                files={"file": f},
                data={"mode": "find", "search_text": field}
            )

            if response.status_code == 200:
                data = response.json()
                if data.get("bboxes"):
                    results[field] = data["bboxes"][0]["text"]

    return results

# 使用示例
invoice_data = extract_invoice_data("invoice.png")
print(f"Total: {invoice_data.get('Total')}")
print(f"Invoice #: {invoice_data.get('Invoice Number')}")
```

### 场景 2: 批量文档处理

**并行处理多个图像：**

```python
import requests
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

def process_single_image(image_path):
    """处理单个图像"""
    with open(image_path, "rb") as f:
        response = requests.post(
            "http://localhost:8001/ocr",
            files={"file": f},
            data={"mode": "doc"}
        )
        return {
            "file": image_path.name,
            "text": response.json()["text"]
        }

def batch_ocr(image_folder, max_workers=5):
    """批量处理图像"""
    image_paths = list(Path(image_folder).glob("*.png"))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(process_single_image, image_paths))

    return results

# 使用示例
results = batch_ocr("./images", max_workers=3)
for result in results:
    print(f"{result['file']}: {len(result['text'])} characters")
```

### 场景 3: PDF 批量处理

**处理多个 PDF 文件：**

```python
import requests
from pathlib import Path

def process_pdf_folder(pdf_folder, output_folder):
    """批量处理 PDF 文件夹"""

    pdf_files = list(Path(pdf_folder).glob("*.pdf"))
    output_path = Path(output_folder)
    output_path.mkdir(exist_ok=True)

    for pdf_file in pdf_files:
        print(f"Processing {pdf_file.name}...")

        with open(pdf_file, "rb") as f:
            response = requests.post(
                "http://localhost:8001/ocr-pdf",
                files={"file": f},
                data={"prompt_type": "document"},
                timeout=600
            )

        if response.status_code == 200:
            result = response.json()

            # 保存合并的文本
            output_file = output_path / f"{pdf_file.stem}.txt"
            output_file.write_text(result["merged_text"], encoding="utf-8")

            # 保存 JSON 元数据
            import json
            json_file = output_path / f"{pdf_file.stem}.json"
            json_file.write_text(json.dumps(result, ensure_ascii=False, indent=2))

            print(f"✓ Saved: {output_file.name} ({result['page_count']} pages)")

# 使用示例
process_pdf_folder("./input_pdfs", "./output_texts")
```

### 场景 4: 表格和图表识别

**提取表格数据并转换为 CSV：**

```python
import requests
import csv
import re

def extract_table_to_csv(image_path, output_csv):
    """从图像提取表格并保存为 CSV"""

    with open(image_path, "rb") as f:
        response = requests.post(
            "http://localhost:8001/ocr",
            files={"file": f},
            data={"mode": "chart"}
        )

    if response.status_code == 200:
        markdown_text = response.json()["text"]

        # 解析 Markdown 表格
        lines = markdown_text.split("\n")
        table_data = []

        for line in lines:
            if "|" in line and not line.strip().startswith("|---"):
                cells = [cell.strip() for cell in line.split("|")[1:-1]]
                table_data.append(cells)

        # 写入 CSV
        if table_data:
            with open(output_csv, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(table_data)

            print(f"✓ Saved table with {len(table_data)} rows to {output_csv}")

# 使用示例
extract_table_to_csv("table.png", "output.csv")
```

---

## 客户端集成

### JavaScript / Node.js

```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// 简单 OCR
async function simpleOCR(imagePath) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(imagePath));
    formData.append('mode', 'ocr');

    const response = await axios.post('http://localhost:8001/ocr', formData, {
        headers: formData.getHeaders()
    });

    return response.data.text;
}

// PDF OCR
async function pdfOCR(pdfPath) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(pdfPath));
    formData.append('prompt_type', 'document');

    const response = await axios.post('http://localhost:8001/ocr-pdf', formData, {
        headers: formData.getHeaders(),
        timeout: 600000  // 10 minutes
    });

    return response.data;
}

// 使用示例
(async () => {
    const text = await simpleOCR('image.png');
    console.log(text);

    const pdfResult = await pdfOCR('document.pdf');
    console.log(`Processed ${pdfResult.page_count} pages`);
})();
```

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "mime/multipart"
    "net/http"
    "os"
)

type OCRResponse struct {
    Text   string `json:"text"`
    Bboxes []struct {
        Text string    `json:"text"`
        Bbox []float64 `json:"bbox"`
    } `json:"bboxes"`
}

func performOCR(imagePath string, mode string) (*OCRResponse, error) {
    file, err := os.Open(imagePath)
    if err != nil {
        return nil, err
    }
    defer file.Close()

    body := &bytes.Buffer{}
    writer := multipart.NewWriter(body)

    part, err := writer.CreateFormFile("file", imagePath)
    if err != nil {
        return nil, err
    }
    io.Copy(part, file)

    writer.WriteField("mode", mode)
    writer.Close()

    req, err := http.NewRequest("POST", "http://localhost:8001/ocr", body)
    if err != nil {
        return nil, err
    }
    req.Header.Set("Content-Type", writer.FormDataContentType())

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result OCRResponse
    json.NewDecoder(resp.Body).Decode(&result)

    return &result, nil
}

func main() {
    result, err := performOCR("image.png", "ocr")
    if err != nil {
        panic(err)
    }
    fmt.Println(result.Text)
}
```

### TypeScript

```typescript
import axios, { AxiosResponse } from 'axios';
import FormData from 'form-data';
import fs from 'fs';

interface OCRResponse {
    text: string;
    bboxes?: Array<{
        text: string;
        bbox: [number, number, number, number];
    }>;
    image_base64?: string;
}

interface PDFResponse {
    success: boolean;
    filename: string;
    page_count: number;
    pages: Array<{
        page: number;
        text: string;
        raw_text: string;
    }>;
    merged_text: string;
    metadata: {
        mode: string;
        backend: string;
    };
}

class DeepSeekOCRClient {
    private baseURL: string;

    constructor(baseURL = 'http://localhost:8001') {
        this.baseURL = baseURL;
    }

    async ocr(
        imagePath: string,
        mode: 'doc' | 'ocr' | 'plain' | 'chart' | 'image' | 'find' | 'custom' = 'ocr',
        options?: {
            search_text?: string;
            custom_prompt?: string;
        }
    ): Promise<OCRResponse> {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(imagePath));
        formData.append('mode', mode);

        if (options?.search_text) {
            formData.append('search_text', options.search_text);
        }
        if (options?.custom_prompt) {
            formData.append('custom_prompt', options.custom_prompt);
        }

        const response: AxiosResponse<OCRResponse> = await axios.post(
            `${this.baseURL}/ocr`,
            formData,
            { headers: formData.getHeaders() }
        );

        return response.data;
    }

    async pdfOCR(
        pdfPath: string,
        promptType: string = 'document'
    ): Promise<PDFResponse> {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(pdfPath));
        formData.append('prompt_type', promptType);

        const response: AxiosResponse<PDFResponse> = await axios.post(
            `${this.baseURL}/ocr-pdf`,
            formData,
            {
                headers: formData.getHeaders(),
                timeout: 600000
            }
        );

        return response.data;
    }

    async health(): Promise<any> {
        const response = await axios.get(`${this.baseURL}/health`);
        return response.data;
    }
}

// 使用示例
(async () => {
    const client = new DeepSeekOCRClient();

    // 健康检查
    const health = await client.health();
    console.log('Backend:', health.backend);

    // OCR
    const result = await client.ocr('image.png', 'doc');
    console.log(result.text);

    // PDF OCR
    const pdfResult = await client.pdfOCR('document.pdf');
    console.log(`Processed ${pdfResult.page_count} pages`);
})();
```

---

## 最佳实践

### 1. 性能优化

#### 使用 GPU 加速
```bash
# GPU 版本性能提升 3-5 倍
docker run -d --gpus all -p 8001:8001 neosun/deepseek-ocr-webui:gpu
```

#### 批量处理优化
```python
# ❌ 不推荐：串行处理
for file in files:
    process_file(file)

# ✅ 推荐：并行处理（限制并发数）
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=3) as executor:
    results = executor.map(process_file, files)
```

#### 超时设置
```python
# PDF 处理需要更长超时时间
response = requests.post(
    "http://localhost:8001/ocr-pdf",
    files={"file": f},
    timeout=600  # 10 minutes for large PDFs
)
```

### 2. 错误处理

```python
import requests
from requests.exceptions import Timeout, RequestException

def robust_ocr(image_path, max_retries=3):
    """带重试机制的 OCR"""

    for attempt in range(max_retries):
        try:
            with open(image_path, "rb") as f:
                response = requests.post(
                    "http://localhost:8001/ocr",
                    files={"file": f},
                    data={"mode": "ocr"},
                    timeout=120
                )

                response.raise_for_status()
                return response.json()

        except Timeout:
            print(f"Timeout on attempt {attempt + 1}")
            if attempt == max_retries - 1:
                raise

        except RequestException as e:
            print(f"Request failed: {e}")
            if attempt == max_retries - 1:
                raise

    return None
```

### 3. 结果验证

```python
def validate_ocr_result(result):
    """验证 OCR 结果"""

    if not result.get("text"):
        raise ValueError("Empty OCR result")

    # 检查文本长度
    if len(result["text"]) < 10:
        print("⚠️  Warning: Very short text detected")

    # 检查是否包含乱码
    if result["text"].count("�") > 5:
        print("⚠️  Warning: Possible encoding issues")

    return result
```

### 4. 资源管理

```python
import contextlib
import requests

@contextlib.contextmanager
def ocr_session():
    """使用会话复用连接"""
    session = requests.Session()
    try:
        yield session
    finally:
        session.close()

# 使用示例
with ocr_session() as session:
    for image in images:
        with open(image, "rb") as f:
            response = session.post(
                "http://localhost:8001/ocr",
                files={"file": f},
                data={"mode": "ocr"}
            )
```

---

## 常见问题

### Q1: 如何提高识别准确率？

**A:** 根据文档类型选择合适的模式：
- 📄 文档 → `mode=doc` (转 Markdown)
- 📊 表格 → `mode=chart`
- 🔍 关键字定位 → `mode=find`
- 🖼️ 图片描述 → `mode=image`

### Q2: PDF 处理很慢怎么办？

**A:**
1. 使用 GPU 版本（性能提升 3-5 倍）
2. 减少 PDF 页数或拆分文件
3. 增加超时时间：`timeout=600`

### Q3: 如何处理大批量文件？

**A:**
```python
# 使用队列 + 限流
from concurrent.futures import ThreadPoolExecutor

def process_batch(files, max_workers=3):
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return list(executor.map(process_file, files))
```

### Q4: 内存占用过高？

**A:**
1. 限制并发数：`max_workers=2`
2. 使用流式处理
3. 及时关闭文件句柄
4. 使用 Docker 内存限制：
```bash
docker run -d --gpus all --memory=8g -p 8001:8001 neosun/deepseek-ocr-webui:gpu
```

### Q5: 如何集成到生产环境？

**A:**
```yaml
# docker-compose.yml
version: '3.8'
services:
  deepseek-ocr:
    image: neosun/deepseek-ocr-webui:gpu
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    ports:
      - "8001:8001"
    restart: unless-stopped
    environment:
      - MAX_WORKERS=4
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Q6: 支持哪些图像格式？

**A:** 支持常见格式：
- PNG
- JPG/JPEG
- PDF（自动转换为图像）
- 其他 PIL 支持的格式

### Q7: 如何处理多语言文档？

**A:** DeepSeek-OCR 原生支持多语言，无需额外配置：
```python
# 自动识别语言
response = requests.post(
    "http://localhost:8001/ocr",
    files={"file": f},
    data={"mode": "ocr"}
)
```

### Q8: API 调用限制？

**A:** 默认无速率限制，建议：
- 自行实现客户端限流
- 使用连接池
- 监控服务器负载

---

## 技术支持

- 📖 [完整文档](https://github.com/yourusername/DeepSeek-OCR-WebUI)
- 🐛 [问题反馈](https://github.com/yourusername/DeepSeek-OCR-WebUI/issues)
- 💬 讨论交流：提交 Issue 或 PR

---

**更新日期:** 2024-12-08
**API 版本:** v3.3+
