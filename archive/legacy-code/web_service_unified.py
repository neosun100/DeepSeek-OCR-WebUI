#!/usr/bin/env python3
"""
DeepSeek-OCR Web Service - Unified Multi-Platform
Auto-detect platform and use appropriate backend:
- Apple Silicon (M1/M2/M3) -> MLX
- NVIDIA GPU -> CUDA/transformers
"""
import os
import re
import tempfile
import shutil
import io
import base64
import platform
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from pathlib import Path
import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
import uvicorn
import fitz
import threading

# Global backend
backend = None
backend_type = None

# ============ Concurrency Control ============
MAX_OCR_QUEUE_SIZE = 8
MAX_PDF_QUEUE_SIZE = 4

# Per-client and per-IP rate limits
MAX_CONCURRENT_PER_CLIENT = 1
MAX_CONCURRENT_PER_IP = 4

ocr_semaphore = None  # Will be initialized in lifespan
pdf_semaphore = None

ocr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr-")
pdf_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pdf-")

# Queue depth counters with thread-safe access
_queue_lock = threading.Lock()
ocr_queue_depth = 0
pdf_queue_depth = 0

# Track active requests per client and IP
_active_clients: dict[str, int] = {}  # client_id -> active count
_active_ips: dict[str, int] = {}  # ip -> active count

# Ordered queue for tracking request position (OrderedDict maintains insertion order)
# Key: request_id (UUID) to uniquely identify each request
from collections import OrderedDict
import time as time_module
import uuid

_request_queue: OrderedDict[str, dict] = OrderedDict()  # request_id -> {client_id, ip, timestamp}


def get_client_identifier(request: Request) -> tuple[str | None, str]:
    """Extract client ID from header and client IP."""
    client_id = request.headers.get("X-Client-ID")
    # Handle X-Forwarded-For for reverse proxy
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown"
    return client_id, client_ip


def check_rate_limit(client_id: str | None, client_ip: str) -> tuple[bool, str]:
    """Check if request should be rate limited. Returns (allowed, reason).
    
    Must be called while holding _queue_lock.
    """
    # 1. Check global queue
    if ocr_queue_depth >= MAX_OCR_QUEUE_SIZE:
        return False, "OCR queue full, please retry later"
    
    # 2. Check per-client limit (if client_id provided)
    if client_id:
        current = _active_clients.get(client_id, 0)
        if current >= MAX_CONCURRENT_PER_CLIENT:
            return False, f"Client at max concurrency ({MAX_CONCURRENT_PER_CLIENT})"
    
    # 3. Check per-IP limit (safety net against client_id spoofing)
    ip_count = _active_ips.get(client_ip, 0)
    if ip_count >= MAX_CONCURRENT_PER_IP:
        return False, f"IP at max concurrency ({MAX_CONCURRENT_PER_IP})"
    
    return True, ""


def register_active_request(client_id: str | None, client_ip: str) -> str:
    """Register a new active request. Must be called while holding _queue_lock.
    
    Returns: request_id for later unregistration
    """
    global ocr_queue_depth
    ocr_queue_depth += 1
    if client_id:
        _active_clients[client_id] = _active_clients.get(client_id, 0) + 1
    _active_ips[client_ip] = _active_ips.get(client_ip, 0) + 1
    
    # Add ALL requests to ordered queue (with or without client_id)
    request_id = str(uuid.uuid4())
    _request_queue[request_id] = {
        "client_id": client_id,
        "ip": client_ip,
        "timestamp": time_module.time()
    }
    return request_id


def unregister_active_request(request_id: str, client_id: str | None, client_ip: str) -> None:
    """Unregister an active request. Must be called while holding _queue_lock."""
    global ocr_queue_depth
    ocr_queue_depth -= 1
    if client_id:
        _active_clients[client_id] = _active_clients.get(client_id, 0) - 1
        if _active_clients[client_id] <= 0:
            del _active_clients[client_id]
    _active_ips[client_ip] = _active_ips.get(client_ip, 0) - 1
    if _active_ips[client_ip] <= 0:
        del _active_ips[client_ip]
    
    # Remove from ordered queue
    if request_id in _request_queue:
        del _request_queue[request_id]


def get_queue_position(client_id: str) -> tuple[int | None, int]:
    """Get the queue position of a client's first request.
    
    Must be called while holding _queue_lock.
    
    Returns: (position (1-indexed, or None if not in queue), total_queued)
    """
    total = len(_request_queue)
    for i, (_, info) in enumerate(_request_queue.items()):
        if info["client_id"] == client_id:
            return i + 1, total
    return None, total


def detect_platform() -> str:
    """Detect platform and return backend type"""
    import os
    system = platform.system()
    machine = platform.machine()
    
    # Force backend via env var
    force_backend = os.environ.get("FORCE_BACKEND", "").lower()
    if force_backend in ["mps", "cuda", "cpu"]:
        print(f"🔧 Forced backend: {force_backend.upper()}")
        return force_backend
    
    # Check Apple Silicon (MPS support)
    if system == "Darwin" and machine == "arm64":
        try:
            import torch
            if torch.backends.mps.is_available():
                print("✅ Detected Apple Silicon with MPS support")
                return "mps"
        except ImportError:
            pass
        print("⚠️ Apple Silicon detected but MPS not available")
    
    # Check NVIDIA GPU
    try:
        import torch
        if torch.cuda.is_available():
            print(f"✅ Detected NVIDIA GPU: {torch.cuda.get_device_name(0)}")
            return "cuda"
    except ImportError:
        pass
    
    # Fallback to CPU
    print("⚠️ No GPU detected, using CPU mode")
    return "cpu"

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model based on platform"""
    global backend, backend_type, ocr_semaphore, pdf_semaphore
    
    print("="*50)
    print("🚀 DeepSeek-OCR-2 Unified Service Starting...")
    print("="*50)
    
    # Check for local model path
    local_model_path = os.environ.get("LOCAL_MODEL_PATH", "")
    model_path = local_model_path if local_model_path else "deepseek-ai/DeepSeek-OCR-2"
    
    if local_model_path:
        print(f"📁 Using local model: {local_model_path}")
    
    backend_type = detect_platform()
    
    if backend_type == "mps":
        # Apple Silicon with MPS
        from backends.mps_backend import MPSBackend
        backend = MPSBackend(model_path=model_path)
        backend.load_model()
    elif backend_type == "cuda":
        from backends.cuda_backend import CUDABackend
        backend = CUDABackend(model_path=model_path)
        # Try HuggingFace first, fallback to ModelScope
        try:
            backend.load_model(source="huggingface", timeout=300)
        except:
            print("🔄 Switching to ModelScope...")
            backend.load_model(source="modelscope")
    elif backend_type == "cpu":
        from backends.cpu_backend import CPUBackend
        backend = CPUBackend(model_path=model_path)
        backend.load_model()
    else:
        raise RuntimeError("No supported backend available")
    
    print(f"✅ Backend loaded: {backend_type.upper()}")
    
    # Initialize semaphores
    ocr_semaphore = asyncio.Semaphore(1)
    pdf_semaphore = asyncio.Semaphore(2)
    print("✅ Concurrency control initialized")
    print("="*50)
    
    yield
    
    print("🛑 Service shutting down...")
    ocr_executor.shutdown(wait=True)
    pdf_executor.shutdown(wait=True)
    print("✅ Thread pools closed")

app = FastAPI(
    title="DeepSeek-OCR Unified API",
    description="Multi-platform OCR service (MLX/CUDA)",
    version="4.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    swagger_ui_parameters={"syntaxHighlight": False}
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "x-client-id", "x-forwarded-for"],
)

# Define frontend path
BASE_DIR = Path(__file__).parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
# Mount all top-level directories in dist to root (assets, cmaps, etc.)
if FRONTEND_DIST.exists():
    for item in FRONTEND_DIST.iterdir():
        if item.is_dir():
            app.mount(f"/{item.name}", StaticFiles(directory=str(item)), name=item.name)
        elif item.name != "index.html" and not item.name.startswith('.'):
            # Also catch top-level files like scan2doc.svg
            @app.get(f"/{item.name}")
            async def serve_file(name=item.name):
                return FileResponse(FRONTEND_DIST / name)

def build_prompt(mode: str, custom_prompt: str = "", find_term: str = "") -> str:
    """Build prompt based on mode"""
    templates = {
        "document": "<image>\n<|grounding|>Convert the document to markdown.",
        "ocr": "<image>\n<|grounding|>OCR this image.",
        "free": "<image>\nFree OCR. Only output the raw text.",
        "figure": "<image>\nParse the figure.",
        "describe": "<image>\nDescribe this image in detail.",
        "find": "<image>\n<|grounding|>Locate <|ref|>{term}<|/ref|> in the image.",
        "freeform": "<image>\n{prompt}",
    }
    
    if mode == "find":
        return templates["find"].replace("{term}", find_term.strip() or "Total")
    elif mode == "freeform":
        return templates["freeform"].replace("{prompt}", custom_prompt.strip() or "OCR this image.")
    return templates.get(mode, templates["document"])

def clean_grounding_text(text: str) -> str:
    """Remove grounding markers"""
    cleaned = re.sub(r"<\|ref\|>(.*?)<\|/ref\|>\s*<\|det\|>\s*\[.*?\]\s*<\|/det\|>", r"\1", text, flags=re.DOTALL)
    cleaned = re.sub(r"<\|grounding\|>", "", cleaned)
    return cleaned.strip()

def parse_detections(text: str, image_width: int, image_height: int) -> List[Dict[str, Any]]:
    """Parse bounding boxes"""
    boxes = []
    pattern = re.compile(r"<\|ref\|>(?P<label>.*?)<\|/ref\|>\s*<\|det\|>\s*(?P<coords>\[.*?\])\s*<\|/det\|>", re.DOTALL)
    
    for m in pattern.finditer(text or ""):
        label = m.group("label").strip()
        coords_str = m.group("coords").strip()
        
        try:
            import ast
            parsed = ast.literal_eval(coords_str)
            
            if isinstance(parsed, list) and len(parsed) == 4:
                box_coords = [parsed]
            elif isinstance(parsed, list):
                box_coords = parsed
            else:
                continue
            
            for box in box_coords:
                if isinstance(box, (list, tuple)) and len(box) >= 4:
                    x1 = int(float(box[0]) / 999 * image_width)
                    y1 = int(float(box[1]) / 999 * image_height)
                    x2 = int(float(box[2]) / 999 * image_width)
                    y2 = int(float(box[3]) / 999 * image_height)
                    boxes.append({"label": label, "box": [x1, y1, x2, y2]})
        except:
            continue
    
    return boxes

@app.get("/", response_class=FileResponse)
async def root():
    """Return Vue 3 Frontend"""
    index_file = FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    
    return HTMLResponse(content="<h1>DeepSeek-OCR-WebUI</h1><p>Frontend dist not found.</p>")

@app.get("/health")
async def health_check(request: Request):
    """Health check with rate limit status and optional queue position"""
    # Extract client ID if present
    client_id = request.headers.get("X-Client-ID")
    
    # Read queue depths and active counts with lock
    with _queue_lock:
        ocr_depth = ocr_queue_depth
        pdf_depth = pdf_queue_depth
        active_clients_count = len(_active_clients)
        active_ips_count = len(_active_ips)
        
        # Get queue position for this client if client_id provided
        if client_id:
            position, total = get_queue_position(client_id)
        else:
            position, total = None, len(_request_queue)
    
    # Determine status based on queue depth
    if ocr_depth >= MAX_OCR_QUEUE_SIZE:
        status = "full"
    elif ocr_depth >= MAX_OCR_QUEUE_SIZE / 2:
        status = "busy"
    else:
        status = "healthy"
    
    response = {
        "status": status,
        "model_version": "DeepSeek-OCR-2",
        "backend": backend_type,
        "platform": platform.system(),
        "machine": platform.machine(),
        "model_loaded": backend is not None,
        # Queue status for front-end monitoring
        "ocr_queue": {
            "depth": ocr_depth,
            "max_size": MAX_OCR_QUEUE_SIZE,
            "is_full": ocr_depth >= MAX_OCR_QUEUE_SIZE,
        },
        "pdf_queue": {
            "depth": pdf_depth,
            "max_size": MAX_PDF_QUEUE_SIZE,
            "is_full": pdf_depth >= MAX_PDF_QUEUE_SIZE,
        },
        # Rate limit configuration and status
        "rate_limits": {
            "max_per_client": MAX_CONCURRENT_PER_CLIENT,
            "max_per_ip": MAX_CONCURRENT_PER_IP,
            "active_clients": active_clients_count,
            "active_ips": active_ips_count,
        },
    }
    
    # Add client-specific queue info if client_id was provided
    if client_id:
        response["your_queue_status"] = {
            "client_id": client_id,
            "position": position,  # 1-indexed, None if not in queue
            "total_queued": total,
        }
    
    return response

@app.post("/ocr")
async def ocr_endpoint(
    request: Request,
    file: UploadFile = File(...),
    prompt_type: str = Form("document"),
    find_term: str = Form(""),
    custom_prompt: str = Form(""),
    grounding: bool = Form(False)
):
    """OCR endpoint with per-client rate limiting"""
    if backend is None:
        raise HTTPException(status_code=503, detail="Backend not loaded")
    
    if ocr_semaphore is None:
        raise HTTPException(status_code=503, detail="Service initializing")
    
    # Extract client identifier
    client_id, client_ip = get_client_identifier(request)
    
    # Composite rate limit check
    with _queue_lock:
        allowed, reason = check_rate_limit(client_id, client_ip)
        if not allowed:
            raise HTTPException(status_code=429, detail=reason)
        request_id = register_active_request(client_id, client_ip)
    
    tmp_file = None
    
    try:
        # Save uploaded image
        image_data = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png', mode='wb') as tmp:
            tmp.write(image_data)
            tmp_file = tmp.name
        
        # Get image dimensions
        with Image.open(tmp_file) as img:
            img = ImageOps.exif_transpose(img).convert('RGB')
            orig_w, orig_h = img.size
        
        # Build prompt
        prompt = build_prompt(prompt_type, custom_prompt, find_term)
        
        # Acquire semaphore and run inference in thread pool
        await ocr_semaphore.acquire()
        try:
            loop = asyncio.get_running_loop()
            text = await loop.run_in_executor(
                ocr_executor,
                backend.infer,
                prompt,
                tmp_file
            )
        finally:
            ocr_semaphore.release()
        
        # Parse boxes
        boxes = parse_detections(text, orig_w, orig_h) if "<|det|>" in text else []
        
        # Clean text
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
                "backend": backend_type,
                "has_boxes": len(boxes) > 0
            }
        })
        
    except Exception as e:
        import traceback
        print(f"❌ Error:\n{traceback.format_exc()}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
        
    finally:
        with _queue_lock:
            unregister_active_request(request_id, client_id, client_ip)
        if tmp_file and os.path.exists(tmp_file):
            os.remove(tmp_file)

def _render_pdf_pages(pdf_path: str) -> list:
    """Synchronous function: Render all PDF pages to images"""
    images = []
    pdf_doc = fitz.open(pdf_path)
    zoom = 144 / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    
    for page_num in range(pdf_doc.page_count):
        page = pdf_doc[page_num]
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        img_data = pixmap.tobytes("png")
        img = Image.open(io.BytesIO(img_data)).convert('RGB')
        
        img_buffer = io.BytesIO()
        img.save(img_buffer, format='PNG', optimize=True)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
        
        images.append({
            "data": f"data:image/png;base64,{img_base64}",
            "name": f"page_{page_num + 1}.png",
            "width": img.size[0],
            "height": img.size[1],
            "page_number": page_num + 1
        })
    
    pdf_doc.close()
    return images


@app.post("/pdf-to-images")
async def pdf_to_images_endpoint(file: UploadFile = File(...)):
    """Convert PDF to images"""
    global pdf_queue_depth
    
    if pdf_semaphore is None:
        raise HTTPException(status_code=503, detail="Service initializing")
    
    # Queue capacity check with lock
    with _queue_lock:
        if pdf_queue_depth >= MAX_PDF_QUEUE_SIZE:
            raise HTTPException(status_code=503, detail="PDF queue full, please retry later")
        pdf_queue_depth += 1
    
    tmp_file = None
    
    try:
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Must be PDF")
        
        pdf_data = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf', mode='wb') as tmp:
            tmp.write(pdf_data)
            tmp_file = tmp.name
        
        # Acquire semaphore and run in thread pool
        async with pdf_semaphore:
            loop = asyncio.get_running_loop()
            images = await loop.run_in_executor(
                pdf_executor,
                _render_pdf_pages,
                tmp_file
            )
        
        return JSONResponse({
            "success": True,
            "images": images,
            "page_count": len(images),
            "original_filename": file.filename
        })
        
    except Exception as e:
        import traceback
        print(f"❌ PDF Error:\n{traceback.format_exc()}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
        
    finally:
        with _queue_lock:
            pdf_queue_depth -= 1
        if tmp_file and os.path.exists(tmp_file):
            os.remove(tmp_file)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    print(f"\n{'='*50}")
    print(f"🚀 DeepSeek-OCR Unified Service")
    print(f"{'='*50}")
    print(f"📍 URL: http://0.0.0.0:{port}")
    print(f"📚 Docs: http://0.0.0.0:{port}/docs")
    print(f"{'='*50}\n")
    
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
