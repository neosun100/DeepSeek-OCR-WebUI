/**
 * Shared OCR raw_text parsing utilities
 * Used by both Markdown and PDF generation
 */
import { consola } from 'consola'

export interface ParsedBlock {
    type: string
    content: string
    box: [number, number, number, number] // [x1, y1, x2, y2]
}

export interface ImageDims {
    w: number
    h: number
}

export interface OCRBox {
    label: string
    box: [number, number, number, number]
}

/**
 * Layout labels emitted by DeepSeek-OCR / OCR-2 in document mode.
 * In ocr / find mode the `<|ref|>` label is the recognized text itself, so a label that is
 * NOT in this set is content and must be kept (dropping it loses text in exports, issue #49).
 * Intentionally duplicated from the backend; authoritative source:
 * server/deepseek_ocr_webui/grounding.py `LAYOUT_LABELS`.
 */
export const LAYOUT_LABELS: ReadonlySet<string> = new Set([
    'title', 'sub_title', 'text', 'table', 'table_caption', 'table_footnote', 'image', 'image_caption',
    'figure', 'figure_caption', 'formula', 'equation', 'header', 'footer', 'page_header', 'page_footer',
    'page_number', 'list', 'list_item', 'code', 'caption', 'footnote', 'reference', 'abstract', 'author',
    'algorithm', 'chart', 'seal', 'aside_text'
])

export function isLayoutLabel(label: string): boolean {
    return LAYOUT_LABELS.has(label.trim().toLowerCase())
}

/**
 * One grounding segment of raw_text.
 * - `boxes` holds every `[x1,y1,x2,y2]` found inside `<|det|>` (a block may carry several, issue #49).
 * - `boxes` is empty when the coordinates could not be parsed; the content is still kept.
 */
export interface RawSegment {
    kind: 'block' | 'text'
    type: string
    content: string
    boxes: number[][]
    parseError?: string
}

// `<|ref|>LABEL<|/ref|>` + optional whitespace + `<|det|>COORDS<|/det|>`; COORDS is free-form and
// parsed separately so a malformed coordinate list never swallows the block's content.
const BLOCK_HEADER_RE = /<\|ref\|>([\s\S]*?)<\|\/ref\|>\s*<\|det\|>([\s\S]*?)<\|\/det\|>/g
// One `[...]` group; its contents are validated as exactly 4 finite numbers in parseDetBoxes
const BOX_RE = /\[([^[\]]*)\]/g
const ORPHAN_TAG_RE = /<\|\/?(?:ref|det|grounding)\|>/g

/**
 * Extract every 4-number box from a `<|det|>` payload such as `[[1,2,3,4],[5,6,7,8]]`.
 */
export function parseDetBoxes(coords: string): number[][] {
    const out: number[][] = []
    for (const m of coords.matchAll(BOX_RE)) {
        const parts = (m[1] ?? '').split(',').map(v => v.trim())
        const nums = parts.map(Number)
        if (parts.length === 4 && parts.every(Boolean) && nums.every(Number.isFinite)) out.push(nums)
    }
    return out
}

/**
 * Bounding box that covers all boxes of a multi-box block.
 */
export function unionBox(boxes: number[][]): [number, number, number, number] {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const b of boxes) {
        x1 = Math.min(x1, b[0] ?? 0)
        y1 = Math.min(y1, b[1] ?? 0)
        x2 = Math.max(x2, b[2] ?? 0)
        y2 = Math.max(y2, b[3] ?? 0)
    }
    return [x1, y1, x2, y2]
}

/**
 * Split raw_text into ordered segments without ever discarding text.
 * Free text between/around blocks becomes `kind: 'text'` segments with no boxes.
 */
export function tokenizeRawText(rawText: string): RawSegment[] {
    const segments: RawSegment[] = []
    if (!rawText) return segments

    const headers = [...rawText.matchAll(BLOCK_HEADER_RE)]
    let cursor = 0

    const pushText = (text: string) => {
        const cleaned = text.replace(ORPHAN_TAG_RE, '').trim()
        if (cleaned) segments.push({ kind: 'text', type: 'text', content: cleaned, boxes: [] })
    }

    headers.forEach((m, i) => {
        const start = m.index ?? 0
        pushText(rawText.substring(cursor, start))

        const next = headers[i + 1]
        const contentEnd = next ? (next.index ?? rawText.length) : rawText.length
        segments.push(buildBlockSegment(m, rawText.substring(start + m[0].length, contentEnd)))
        cursor = contentEnd
    })

    pushText(rawText.substring(cursor))
    return segments
}

function buildBlockSegment(header: RegExpMatchArray, rawBody: string): RawSegment {
    const label = (header[1] ?? '').trim()
    const coords = header[2] ?? ''
    const body = rawBody.replace(ORPHAN_TAG_RE, '').trim()

    // ocr / find mode: the label IS the recognized text → keep it as content
    const textLabel = label && !isLayoutLabel(label) ? label : ''
    const content = [textLabel, body].filter(Boolean).join(' ')
    const type = textLabel ? 'text' : label.toLowerCase() || 'text'

    const boxes = parseDetBoxes(coords)
    const segment: RawSegment = { kind: 'block', type, content, boxes }
    if (boxes.length === 0) {
        segment.parseError = `unparseable <|det|> coordinates: ${coords.slice(0, 80)}`
        // Degrade visibly: keep the text, log that layout info was lost
        consola.withTag('DocGen').warn('[ocr-parser] keeping block without coordinates', {
            type,
            coords: coords.slice(0, 80),
            contentChars: content.length
        })
    }
    return segment
}

/**
 * Parse OCR raw_text with special tags into structured blocks.
 * Uses the boxes array for accurate coordinates when available.
 *
 * Format: <|ref|>TYPE<|/ref|><|det|>[[x1,y1,x2,y2], ...]<|/det|>CONTENT
 * Multi-box blocks use the union of their boxes. Blocks whose coordinates cannot be parsed
 * and free text are kept with a full-page box (text is never dropped, issue #49).
 *
 * @param rawText The raw_text string from OCR result
 * @param imageDims Image dimensions for coordinate normalization
 * @param boxes Optional boxes array with accurate coordinates
 * @returns Array of parsed blocks with type, content, and box coordinates
 */
export function parseRawText(rawText: string, imageDims: ImageDims, boxes?: OCRBox[]): ParsedBlock[] {
    const parsedBlocks: ParsedBlock[] = []
    const usedBoxIndices = new Set<number>()

    for (const seg of tokenizeRawText(rawText)) {
        if (seg.boxes.length === 0) {
            if (!seg.content) continue
            parsedBlocks.push({ type: seg.type, content: seg.content, box: [0, 0, imageDims.w, imageDims.h] })
            continue
        }
        const finalBox = seg.boxes.length === 1
            ? resolveBoxCoordinates(seg.boxes[0]!, imageDims, boxes, usedBoxIndices)
            : resolveMultiBox(seg.boxes, imageDims, boxes, usedBoxIndices)
        parsedBlocks.push({ type: seg.type, content: seg.content, box: finalBox })
    }

    return parsedBlocks
}

function resolveMultiBox(
    rawBoxes: number[][],
    imageDims: ImageDims,
    boxes: OCRBox[] | undefined,
    usedBoxIndices: Set<number>
): [number, number, number, number] {
    return unionBox(rawBoxes.map(b => resolveBoxCoordinates(b, imageDims, boxes, usedBoxIndices)))
}

/**
 * Resolve the final box coordinates by trying to match with boxes array,
 * falling back to normalized coordinates.
 */
function resolveBoxCoordinates(
    rawCoords: number[],
    imageDims: ImageDims,
    boxes: OCRBox[] | undefined,
    usedBoxIndices: Set<number>
): [number, number, number, number] {
    if (boxes && boxes.length > 0) {
        const matchingBoxIndex = findMatchingBoxIndex(rawCoords, boxes, imageDims, usedBoxIndices)
        const matchedBox = matchingBoxIndex !== -1 ? boxes[matchingBoxIndex] : undefined
        if (matchedBox) {
            usedBoxIndices.add(matchingBoxIndex)
            return matchedBox.box
        }
    }

    // Fallback to normalized coords
    const normalized = normalizeBox(rawCoords, imageDims)
    return normalized as [number, number, number, number]
}

/**
 * Find matching box index by comparing normalized coordinates with boxes array.
 * Uses a tolerance-based approach to match coordinates.
 */
export function findMatchingBoxIndex(
    rawCoords: number[],
    boxes: OCRBox[],
    imageDims: ImageDims | undefined,
    usedBoxIndices: Set<number> = new Set()
): number {
    if (!imageDims || boxes.length === 0 || rawCoords.length !== 4) return -1

    // Normalize the raw coords to actual image dimensions for comparison
    // Normalize the raw coords to actual image dimensions for comparison
    const dims = imageDims!
    const normalizedCoords = [
        (rawCoords[0]! / 1000) * dims.w,
        (rawCoords[1]! / 1000) * dims.h,
        (rawCoords[2]! / 1000) * dims.w,
        (rawCoords[3]! / 1000) * dims.h,
    ]

    // Use a percentage-based tolerance (5% of image dimension)
    const toleranceX = imageDims.w * 0.05
    const toleranceY = imageDims.h * 0.05

    for (let i = 0; i < boxes.length; i++) {
        // Skip already matched boxes
        if (usedBoxIndices.has(i)) continue

        const currentBox = boxes[i]
        if (!currentBox) continue

        if (isBoxMatching(currentBox.box, normalizedCoords, toleranceX, toleranceY)) {
            return i
        }
    }

    return -1
}

function isBoxMatching(
    box1: [number, number, number, number],
    box2: number[],
    toleranceX: number,
    toleranceY: number
): boolean {
    return (
        Math.abs(box1[0] - (box2[0] || 0)) <= toleranceX &&
        Math.abs(box1[1] - (box2[1] || 0)) <= toleranceY &&
        Math.abs(box1[2] - (box2[2] || 0)) <= toleranceX &&
        Math.abs(box1[3] - (box2[3] || 0)) <= toleranceY
    )
}

/**
 * Normalize box coordinates from 0-1000 scale to actual image dimensions if needed.
 * 
 * @param coords Raw coordinates [x1, y1, x2, y2]
 * @param dims Image dimensions
 * @returns Normalized coordinates
 */
export function normalizeBox(coords: number[], dims: ImageDims | undefined): number[] {
    if (!dims || coords.length < 4) return [0, 0, 0, 0]

    // If max coordinate <= 1000 and the image dimension is > 1000, 
    // assume it is 1000-normalized.
    const maxCoord = Math.max(...coords)
    if (maxCoord <= 1000 && (dims.w > 1000 || dims.h > 1000)) {
        return [
            ((coords[0] || 0) / 1000) * dims.w,
            ((coords[1] || 0) / 1000) * dims.h,
            ((coords[2] || 0) / 1000) * dims.w,
            ((coords[3] || 0) / 1000) * dims.h,
        ]
    }
    return coords
}

