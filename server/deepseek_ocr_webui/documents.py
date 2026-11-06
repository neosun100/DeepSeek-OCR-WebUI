"""上传文件的校验与解码。

两段式（移植自 aws-gpu Unlimited-OCR `documents.py`）：
1. `plan_*`：毫秒级，所有不需要像素的闸门（类型嗅探、加密、页数、按 rect 估像素）—— 在占用 GPU 之前拒绝坏输入。
2. `rasterize_pdf`：逐页 generator；MuPDF 的全局上下文不是线程安全的 ⇒ 全局锁只包单页渲染。

v4 的 /pdf-to-images 把整本 PDF 的 base64 PNG 一次塞进 JSON（#31 大 PDF 卡死 Docker 的根因之一），这里不再这么做。
"""

from __future__ import annotations

import io
import re
import threading
from collections.abc import Iterator
from dataclasses import dataclass

import pymupdf as fitz
from PIL import Image, ImageOps

from .config import Limits
from .errors import InputError

_FITZ_LOCK = threading.Lock()

# Pillow 自带的解压炸弹闸：超过 2× 这个值直接抛错；我们自己在读头时先判（给四要素错误），这里是第二道
Image.MAX_IMAGE_PIXELS = Limits.MAX_IMAGE_MPIX * 1_000_000

_MAGIC: list[tuple[bytes, str]] = [
    (b"%PDF-", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpeg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"BM", "bmp"),
    (b"II*\x00", "tiff"),
    (b"MM\x00*", "tiff"),
]


def sniff(data: bytes) -> str | None:
    """按文件头判类型（不信扩展名 / Content-Type）。"""
    head = data[:16]
    for magic, kind in _MAGIC:
        if head.startswith(magic):
            return kind
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    # 部分 PDF 文件头前有少量垃圾字节（规范允许 1024 字节内）
    if b"%PDF-" in data[:1024]:
        return "pdf"
    return None


SUPPORTED_IMAGES = ("png", "jpeg", "webp", "bmp", "tiff", "gif")


def load_image(data: bytes) -> Image.Image:
    kind = sniff(data)
    if kind not in SUPPORTED_IMAGES:
        raise InputError(
            415,
            "unsupported_media_type",
            "不支持的文件类型：/ocr 只接受图片（PNG/JPEG/WebP/BMP/TIFF/GIF）；PDF 请用 /api/ocr/pdf",
            actual=kind or "unknown",
            limit=list(SUPPORTED_IMAGES),
        )
    try:
        im = Image.open(io.BytesIO(data))
        w, h = im.size  # 只读头，不解码
    except Exception as e:  # PIL 对坏文件抛多种异常
        raise InputError(422, "image_decode_failed", f"图片无法解析：{e}", actual=kind) from e
    mpix = w * h / 1e6
    if mpix > Limits.MAX_IMAGE_MPIX:
        raise InputError(
            413,
            "image_too_large",
            "图片像素数超过上限（防解压炸弹）",
            actual=f"{w}x{h} ({mpix:.1f} MP)",
            limit=f"{Limits.MAX_IMAGE_MPIX} MP",
        )
    try:
        im = ImageOps.exif_transpose(im)  # 手机照片的 EXIF 旋转（v4 已有，保留）
        return im.convert("RGB")
    except Exception as e:
        raise InputError(422, "image_decode_failed", f"图片解码失败：{e}", actual=kind) from e


@dataclass(frozen=True)
class PdfPlan:
    page_count: int
    pages: list[int]  # 0-based，按请求顺序


def parse_page_spec(spec: str | None, page_count: int) -> list[int]:
    """'1-3,5' → [0,1,2,4]（1-based 输入，0-based 输出）。空 = 全部。"""
    if not spec or not spec.strip():
        return list(range(page_count))
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", part)
        if not m:
            raise InputError(422, "invalid_page_spec", "页码格式应为 '1-3,5' 这样的形式", actual=spec)
        a = int(m.group(1))
        b = int(m.group(2) or a)
        if a < 1 or b < a or b > page_count:
            raise InputError(422, "page_out_of_range", "页码超出范围", actual=part, limit=f"1-{page_count}")
        out.extend(range(a - 1, b))
    return list(dict.fromkeys(out))  # 去重并保持请求顺序


def plan_pdf(data: bytes, *, pages: str | None, max_pages: int, dpi: int = Limits.PDF_DPI) -> PdfPlan:
    if sniff(data) != "pdf":
        raise InputError(
            415, "unsupported_media_type", "文件不是 PDF", actual=sniff(data) or "unknown", limit="pdf"
        )
    try:
        with _FITZ_LOCK:
            doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:  # MuPDF 对损坏文件抛 RuntimeError / FileDataError 等
        raise InputError(422, "pdf_open_failed", f"PDF 无法打开：{e}") from e
    try:
        if doc.needs_pass:
            raise InputError(422, "pdf_encrypted", "PDF 已加密（需要密码），请先解密再上传")
        n = doc.page_count
        if n < 1:
            raise InputError(422, "pdf_empty", "PDF 没有页面", actual=n, limit=">= 1")
        selected = parse_page_spec(pages, n)
        if len(selected) > max_pages:
            raise InputError(
                413,
                "too_many_pages",
                "请求的页数超过单次上限，请用 pages 参数分批",
                actual=len(selected),
                limit=max_pages,
            )
        zoom = dpi / 72.0
        for p in selected:
            r = doc[p].rect
            mpix = (r.width * zoom) * (r.height * zoom) / 1e6
            if mpix > Limits.MAX_PAGE_MPIX:
                raise InputError(
                    413,
                    "page_too_large",
                    f"第 {p + 1} 页按 {dpi} DPI 渲染后像素数超过上限",
                    actual=f"{mpix:.1f} MP",
                    limit=f"{Limits.MAX_PAGE_MPIX} MP",
                )
        return PdfPlan(page_count=n, pages=selected)
    finally:
        with _FITZ_LOCK:
            doc.close()


def rasterize_pdf(
    data: bytes, pages: list[int], dpi: int = Limits.PDF_DPI
) -> Iterator[tuple[int, Image.Image]]:
    """逐页渲染（锁只包单页 ⇒ 并发请求交错推进，不会整本排队）。"""
    with _FITZ_LOCK:
        doc = fitz.open(stream=data, filetype="pdf")
    try:
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        for p in pages:
            with _FITZ_LOCK:
                pix = doc[p].get_pixmap(matrix=mat, alpha=False)
                # 直接拿 RGB 像素，不走 PNG 编码再解码（v4 每页 PNG→PIL→PNG 编了两次）
                im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            yield p, im
    finally:
        with _FITZ_LOCK:
            doc.close()
