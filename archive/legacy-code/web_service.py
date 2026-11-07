#!/usr/bin/env python3
"""
DeepSeek-OCR Web Service - 增强版
基于 transformers 的稳定实现（替代 vLLM）
集成了 Find 和 Freeform 功能
"""
import os
import re
import tempfile
import shutil
import io
import base64
import time
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
import torch
from transformers import AutoModel, AutoTokenizer
import uvicorn
import fitz  # PyMuPDF

# 全局变量
model = None
tokenizer = None
MODEL_PATH = 'deepseek-ai/DeepSeek-OCR-2'
MODEL_SOURCE = None  # 记录实际使用的模型源

# 模型源配置
MODEL_SOURCES = {
    'huggingface': 'deepseek-ai/DeepSeek-OCR-2',
    'modelscope': 'deepseek-ai/DeepSeek-OCR-2'
}

# 自定义超时异常
class ModelLoadTimeoutError(Exception):
    """模型加载超时异常"""
    pass

def load_model_from_source(source_name: str, model_path: str, timeout: int = 300) -> tuple:
    """
    从指定源加载模型
    
    Args:
        source_name: 模型源名称 ('huggingface' 或 'modelscope')
        model_path: 模型路径
        timeout: 超时时间（秒）
    
    Returns:
        (model, tokenizer) 元组
    
    Raises:
        TimeoutError: 加载超时
        Exception: 其他加载错误
    """
    import requests
    from requests.exceptions import Timeout as RequestsTimeout, ConnectionError as RequestsConnectionError
    
    print(f"📦 尝试从 {source_name.upper()} 加载模型: {model_path}")
    
    if source_name == 'modelscope':
        try:
            from modelscope import snapshot_download
            
            print(f"📥 正在从 ModelScope 下载模型...")
            print(f"   模型路径: {model_path}")
            print(f"   缓存目录: {os.environ.get('MODELSCOPE_CACHE', os.path.expanduser('~/.cache/modelscope'))}")
            
            local_model_path = snapshot_download(
                model_id=model_path,
                cache_dir=os.environ.get('MODELSCOPE_CACHE', os.path.expanduser('~/.cache/modelscope')),
                revision='master'
            )
            print(f"✅ ModelScope 模型已下载到: {local_model_path}")
            
            print(f"📦 正在从本地路径加载模型...")
            tokenizer = AutoTokenizer.from_pretrained(
                local_model_path,
                trust_remote_code=True,
            )
            
            model = AutoModel.from_pretrained(
                local_model_path,
                _attn_implementation='flash_attention_2',
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=torch.bfloat16,
            ).eval().to("cuda")
            
            return model, tokenizer
            
        except Exception as e:
            print(f"❌ ModelScope 加载失败: {e}")
            import traceback
            print(f"   错误详情: {traceback.format_exc()}")
            raise
    else:
        # HuggingFace 加载
        try:
            os.environ['HF_HUB_DOWNLOAD_TIMEOUT'] = str(timeout)
            
            print(f"📥 正在从 HuggingFace 下载模型...")
            print(f"   超时设置: {timeout} 秒")
            
            tokenizer = AutoTokenizer.from_pretrained(
                model_path,
                trust_remote_code=True,
            )
            print(f"✅ Tokenizer 加载成功")
            
            model = AutoModel.from_pretrained(
                model_path,
                _attn_implementation='flash_attention_2',
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=torch.bfloat16,
            ).eval().to("cuda")
            print(f"✅ Model 加载成功")
            
            return model, tokenizer
            
        except (RequestsTimeout, RequestsConnectionError) as e:
            print(f"⏱️ HuggingFace 网络连接超时或失败: {e}")
            raise ModelLoadTimeoutError(f"HuggingFace 连接超时 ({timeout} 秒)")
        except Exception as e:
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ['timeout', 'connection', 'network', 'unreachable', 'refused']):
                print(f"⏱️ HuggingFace 网络错误: {e}")
                raise ModelLoadTimeoutError(f"HuggingFace 网络错误: {e}")
            else:
                print(f"❌ HuggingFace 加载失败: {e}")
                import traceback
                print(f"   错误详情: {traceback.format_exc()}")
                raise

@asynccontextmanager
async def lifespan(app: FastAPI):
    """模型加载生命周期 - 支持自动切换模型源"""
    global model, tokenizer, MODEL_SOURCE
    
    print("="*50)
    print("🚀 DeepSeek-OCR 增强版启动中...")
    print("="*50)
    
    model_loaded = False
    last_error = None
    
    # 尝试从 HuggingFace 加载
    for source_name in ['huggingface', 'modelscope']:
        if model_loaded:
            break
            
        try:
            print(f"\n🔄 尝试从 {source_name.upper()} 加载模型...")
            model_path = MODEL_SOURCES[source_name]
            
            model, tokenizer = load_model_from_source(
                source_name=source_name,
                model_path=model_path,
                timeout=300  # 5分钟超时
            )
            
            # 设置 pad token
            if getattr(tokenizer, "pad_token_id", None) is None and getattr(tokenizer, "eos_token_id", None) is not None:
                tokenizer.pad_token = tokenizer.eos_token
            if getattr(model.config, "pad_token_id", None) is None and getattr(tokenizer, "pad_token_id", None) is not None:
                model.config.pad_token_id = tokenizer.pad_token_id
            
            print(f"✅ 模型从 {source_name.upper()} 加载成功！")
            print("="*50)
            model_loaded = True
            MODEL_SOURCE = source_name  # 记录使用的模型源
            
        except (ModelLoadTimeoutError, Exception) as e:
            error_type = type(e).__name__
            if isinstance(e, ModelLoadTimeoutError) or 'timeout' in str(e).lower() or 'connection' in str(e).lower():
                print(f"⏱️ {source_name.upper()} 加载超时/网络错误: {e}")
            else:
                print(f"❌ {source_name.upper()} 加载失败 ({error_type}): {e}")
            
            last_error = e
            if source_name == 'huggingface':
                print("🔄 HuggingFace 加载失败，自动切换到 ModelScope...")
                print("   这通常是因为网络无法访问 HuggingFace")
                time.sleep(2)  # 短暂等待
            continue
    
    if not model_loaded:
        error_msg = f"所有模型源加载失败。最后错误: {last_error}"
        print(f"❌ {error_msg}")
        raise RuntimeError(error_msg)
    
    yield
    
    print("🛑 服务关闭中...")

# FastAPI 应用
app = FastAPI(
    title="DeepSeek-OCR API - 增强版",
    description="智能 OCR 识别服务 · Find & Freeform 支持",
    version="3.0.0",
    lifespan=lifespan
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def build_prompt(
    mode: str,
    custom_prompt: str = "",
    find_term: str = "",
    grounding: bool = False
) -> str:
    """构建提示词"""
    
    # 模式映射
    prompt_templates = {
        "document": "<image>\n<|grounding|>Convert the document to markdown.",
        "ocr": "<image>\n<|grounding|>OCR this image.",
        "free": "<image>\nFree OCR. Only output the raw text.",
        "figure": "<image>\nParse the figure.",
        "describe": "<image>\nDescribe this image in detail.",
        "find": "<image>\n<|grounding|>Locate <|ref|>{term}<|/ref|> in the image.",
        "freeform": "<image>\n{prompt}",
    }
    
    # 构建最终 prompt
    if mode == "find":
        term = find_term.strip() or "Total"
        prompt = prompt_templates["find"].replace("{term}", term)
    elif mode == "freeform":
        user_prompt = custom_prompt.strip() or "OCR this image."
        prompt = prompt_templates["freeform"].replace("{prompt}", user_prompt)
    else:
        prompt = prompt_templates.get(mode, prompt_templates["document"])
    
    return prompt

def clean_grounding_text(text: str) -> str:
    """移除 grounding 标记"""
    cleaned = re.sub(
        r"<\|ref\|>(.*?)<\|/ref\|>\s*<\|det\|>\s*\[.*?\]\s*<\|/det\|>",
        r"\1",
        text,
        flags=re.DOTALL,
    )
    cleaned = re.sub(r"<\|grounding\|>", "", cleaned)
    return cleaned.strip()

def parse_detections(text: str, image_width: int, image_height: int) -> List[Dict[str, Any]]:
    """解析边界框坐标"""
    boxes = []
    
    DET_BLOCK = re.compile(
        r"<\|ref\|>(?P<label>.*?)<\|/ref\|>\s*<\|det\|>\s*(?P<coords>\[.*?\])\s*<\|/det\|>",
        re.DOTALL,
    )
    
    for m in DET_BLOCK.finditer(text or ""):
        label = m.group("label").strip()
        coords_str = m.group("coords").strip()
        
        try:
            import ast
            parsed = ast.literal_eval(coords_str)
            
            # 标准化为列表的列表
            if isinstance(parsed, list) and len(parsed) == 4 and all(isinstance(n, (int, float)) for n in parsed):
                box_coords = [parsed]
            elif isinstance(parsed, list):
                box_coords = parsed
            else:
                continue
            
            # 处理每个 box
            for box in box_coords:
                if isinstance(box, (list, tuple)) and len(box) >= 4:
                    # 从 0-999 归一化坐标转换为实际像素坐标
                    x1 = int(float(box[0]) / 999 * image_width)
                    y1 = int(float(box[1]) / 999 * image_height)
                    x2 = int(float(box[2]) / 999 * image_width)
                    y2 = int(float(box[3]) / 999 * image_height)
                    boxes.append({"label": label, "box": [x1, y1, x2, y2]})
        except Exception as e:
            print(f"❌ 解析坐标失败: {e}")
            continue
    
    return boxes

@app.get("/", response_class=HTMLResponse)
async def root():
    """返回 Web UI"""
    ui_file_path = Path(__file__).parent / "ocr_ui_modern.html"
    
    if ui_file_path.exists():
        with open(ui_file_path, 'r', encoding='utf-8') as f:
            return HTMLResponse(content=f.read())
    
    return HTMLResponse(content="<h1>DeepSeek-OCR Web UI</h1><p>UI file not found</p>")

@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "model": MODEL_PATH,
        "model_source": MODEL_SOURCE or "unknown",
        "engine": "transformers",
        "model_loaded": model is not None,
        "gpu_available": torch.cuda.is_available(),
        "gpu_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "available_sources": list(MODEL_SOURCES.keys())
    }

@app.post("/ocr")
async def ocr_endpoint(
    file: UploadFile = File(...),
    prompt_type: str = Form("document"),
    find_term: str = Form(""),
    custom_prompt: str = Form(""),
    grounding: bool = Form(False)
):
    """OCR 识别接口 - 增强版支持 Find 和 Freeform"""
    
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="模型未加载")
    
    tmp_file = None
    output_dir = None
    
    try:
        # 读取上传的图片数据
        image_data = await file.read()
        
        # 保存到临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png', mode='wb') as tmp:
            tmp.write(image_data)
            tmp_file = tmp.name
        
        print(f"📸 临时文件已保存: {tmp_file}")
        
        # 读取图片获取尺寸
        try:
            with Image.open(tmp_file) as img:
                img = ImageOps.exif_transpose(img)
                img = img.convert('RGB')
                orig_w, orig_h = img.size
                print(f"📐 图片尺寸: {orig_w}x{orig_h}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"图片加载失败: {str(e)}")
        
        # 构建 prompt
        prompt = build_prompt(prompt_type, custom_prompt, find_term, grounding)
        print(f"💬 提示词: {prompt[:100]}...")
        
        # 创建输出目录
        output_dir = tempfile.mkdtemp(prefix="ocr_")
        
        # 执行推理
        print(f"🚀 开始推理...")
        result = model.infer(
            tokenizer,
            prompt=prompt,
            image_file=tmp_file,
            output_path=output_dir,
            base_size=1024,
            image_size=768,
            crop_mode=True,
            save_results=False,
            eval_mode=True,
        )
        
        print(f"✅ 推理完成，结果类型: {type(result)}")
        
        # 处理结果
        if isinstance(result, str):
            text = result.strip()
        elif isinstance(result, dict) and "text" in result:
            text = str(result["text"]).strip()
        else:
            text = str(result).strip()
        
        # 如果没有结果，检查输出文件
        if not text:
            result_file = os.path.join(output_dir, "result.mmd")
            if os.path.exists(result_file):
                with open(result_file, 'r', encoding='utf-8') as f:
                    text = f.read().strip()
        
        if not text:
            text = "模型未返回结果"
        
        print(f"📝 结果长度: {len(text)} 字符")
        
        # 解析 grounding boxes
        boxes = []
        if "<|det|>" in text or "<|ref|>" in text:
            boxes = parse_detections(text, orig_w, orig_h)
            print(f"📦 找到 {len(boxes)} 个边界框")
        
        # 清理显示文本
        display_text = clean_grounding_text(text)
        
        if not display_text and boxes:
            display_text = ", ".join([b["label"] for b in boxes])
        
        return JSONResponse({
            "success": True,
            "text": display_text,
            "raw_text": text,
            "boxes": boxes,
            "image_dims": {"w": orig_w, "h": orig_h},
            "prompt_type": prompt_type,
            "metadata": {
                "mode": prompt_type,
                "grounding": grounding or (prompt_type in ["find", "document", "ocr"]),
                "has_boxes": len(boxes) > 0,
                "engine": "transformers"
            }
        })
        
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"❌ 错误详情:\n{error_detail}")
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)
        
    finally:
        # 清理临时文件
        if tmp_file and os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
                print(f"🗑️ 临时文件已删除: {tmp_file}")
            except Exception as e:
                print(f"⚠️ 删除临时文件失败: {e}")
        if output_dir and os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)
            print(f"🗑️ 输出目录已清理: {output_dir}")

def pdf_to_images(pdf_path: str, dpi: int = 144) -> List[Image.Image]:
    """
    将 PDF 转换为图片列表
    使用 PyMuPDF (fitz) 进行高质量转换
    
    Args:
        pdf_path: PDF 文件路径
        dpi: 输出分辨率，默认 144 DPI（高质量）
    
    Returns:
        图片列表，每页一个 PIL Image 对象
    """
    images = []
    pdf_document = None
    
    try:
        pdf_document = fitz.open(pdf_path)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        
        for page_num in range(pdf_document.page_count):
            page = pdf_document[page_num]
            
            # 将页面渲染为像素图
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            
            # 转换为 PIL Image
            img_data = pixmap.tobytes("png")
            img = Image.open(io.BytesIO(img_data))
            
            # 确保是 RGB 模式
            if img.mode in ('RGBA', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            images.append(img)
            print(f"📄 PDF 第 {page_num + 1} 页已转换为图片 ({img.size[0]}x{img.size[1]})")
        
        print(f"✅ PDF 转换完成，共 {len(images)} 页")
        
    except Exception as e:
        print(f"❌ PDF 转换失败: {e}")
        raise HTTPException(status_code=400, detail=f"PDF 转换失败: {str(e)}")
    finally:
        if pdf_document:
            pdf_document.close()
    
    return images

@app.post("/pdf-to-images")
async def pdf_to_images_endpoint(file: UploadFile = File(...)):
    """
    PDF 转图片接口
    接收 PDF 文件，返回多张图片的 base64 编码列表
    
    Returns:
        {
            "success": bool,
            "images": [{"data": "base64", "name": "page_1.png", "width": int, "height": int}, ...],
            "page_count": int,
            "original_filename": str
        }
    """
    tmp_file = None
    
    try:
        # 验证文件类型
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="文件必须是 PDF 格式")
        
        # 读取 PDF 数据
        pdf_data = await file.read()
        
        # 保存到临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf', mode='wb') as tmp:
            tmp.write(pdf_data)
            tmp_file = tmp.name
        
        print(f"📄 PDF 文件已保存: {tmp_file} (大小: {len(pdf_data)} 字节)")
        
        # 先打开PDF获取总页数
        pdf_document = fitz.open(tmp_file)
        total_pages = pdf_document.page_count
        pdf_document.close()
        
        print(f"📄 PDF 文件总页数: {total_pages}")
        
        # 转换 PDF 为图片
        images = pdf_to_images(tmp_file, dpi=144)
        
        if not images:
            raise HTTPException(status_code=400, detail="PDF 文件为空或无法转换")
        
        # 转换为 base64 编码
        image_list = []
        original_name = file.filename or "document.pdf"
        base_name = os.path.splitext(os.path.basename(original_name))[0]
        
        for idx, img in enumerate(images):
            # 将 PIL Image 转换为 PNG bytes
            img_buffer = io.BytesIO()
            img.save(img_buffer, format='PNG', optimize=True)
            img_bytes = img_buffer.getvalue()
            
            # 转换为 base64
            img_base64 = base64.b64encode(img_bytes).decode('utf-8')
            
            image_list.append({
                "data": f"data:image/png;base64,{img_base64}",
                "name": f"{base_name}_page_{idx + 1}.png",
                "width": img.size[0],
                "height": img.size[1],
                "page_number": idx + 1
            })
            
            print(f"✅ 已转换第 {idx + 1}/{total_pages} 页")
        
        print(f"✅ 成功转换 {len(image_list)} 张图片")
        
        return JSONResponse({
            "success": True,
            "images": image_list,
            "page_count": len(image_list),
            "total_pages": total_pages,
            "original_filename": original_name
        })
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"❌ PDF 转图片错误:\n{error_detail}")
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)
        
    finally:
        # 清理临时文件
        if tmp_file and os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
                print(f"🗑️ 临时 PDF 文件已删除: {tmp_file}")
            except Exception as e:
                print(f"⚠️ 删除临时文件失败: {e}")

if __name__ == "__main__":
    import sys
    
    port = 8001
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except:
            port = 8001
    
    print("\n" + "="*50)
    print("🚀 DeepSeek-OCR 增强版 Web 服务")
    print("="*50)
    print(f"📍 服务已启动，监听地址: 0.0.0.0:{port}")
    print(f"📚 API 文档: http://localhost:{port}/docs")
    print(f"❤️ 健康检查: http://localhost:{port}/health")
    print("\n💡 访问方式:")
    print("   - 本地访问: http://localhost:8001")
    print("   - 局域网访问: http://<服务器IP>:8001")
    print("   - 域名访问: http://<您的域名>:8001")
    print("="*50 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
