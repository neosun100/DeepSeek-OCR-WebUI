/**
 * Shared PDF.js configuration.
 *
 * Deliberately does NOT import pdfjs-dist: this module is used by the main-thread queue, and
 * pdf.js (~400 KB) should only be loaded inside the render worker.
 */

// Use local CMaps from public directory for better reliability and CJK support
// This path is relative to the web root
// export const CMAP_URL = 'cmaps/'
// export const CMAP_PACKED = true
// export const STANDARD_FONT_DATA_URL = 'standard_fonts/'

export const CMAP_URL = 'cmaps/'
export const CMAP_PACKED = true
export const STANDARD_FONT_DATA_URL = 'standard_fonts/'

/**
 * Common document loading parameters for getDocument
 */
export const DOCUMENT_INIT_PARAMS = {
    cMapUrl: CMAP_URL,
    cMapPacked: CMAP_PACKED,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: true,
    fontExtraProperties: true,
}

/**
 * Page rendering settings (shared by the queue and the render worker).
 *
 * Target long edge = 2304 px. Rationale (DeepSeek-OCR-2 preprocessing, modeling_deepseekocr2.py):
 * images larger than 768x768 are tiled by dynamic_preprocess(min_num=2, max_num=6, image_size=768)
 * plus a padded 1024 global view. For A4/Letter pages the closest tile grid is 2x3 (portrait) or
 * 3x2 (landscape), so the model resizes every such page to 1536x2304 anyway. Rendering the long
 * edge at 2304 px loses nothing for typical documents, while the old fixed scale 2.5 produced
 * arbitrarily large canvases for oversized pages (A3, posters, scans with a large MediaBox).
 */
export const PAGE_RENDER_CONFIG = {
    targetLongEdgePx: 2304,
    /** Never upscale tiny pages beyond this (vector content gains nothing past ~4x) */
    maxScale: 4,
    /**
     * JPEG instead of PNG: several times smaller for scanned pages. WebP is avoided because Safari
     * cannot encode it (convertToBlob silently returns PNG) and the text+image PDF export only
     * embeds JPG/PNG (doc-gen/pdf.ts embedImage).
     */
    imageFormat: 'jpeg' as PageImageFormat,
    quality: 0.92,
    /** A page that does not come back from the worker within this time is marked as error */
    renderTimeoutMs: 120_000
}

export type PageImageFormat = 'jpeg' | 'png'

/**
 * Scale that maps the page's long edge (PDF points at scale 1) to the target pixel size.
 */
export function computeRenderScale(
    widthPt: number,
    heightPt: number,
    targetLongEdgePx: number = PAGE_RENDER_CONFIG.targetLongEdgePx,
    maxScale: number = PAGE_RENDER_CONFIG.maxScale
): number {
    const longEdge = Math.max(widthPt, heightPt)
    if (!Number.isFinite(longEdge) || longEdge <= 0) {
        throw new Error(`Invalid page size: ${widthPt}x${heightPt}`)
    }
    return Math.min(maxScale, targetLongEdgePx / longEdge)
}

export function imageMimeType(format: PageImageFormat): string {
    return format === 'jpeg' ? 'image/jpeg' : 'image/png'
}

export function imageExtension(format: PageImageFormat): string {
    return format === 'jpeg' ? 'jpg' : 'png'
}
