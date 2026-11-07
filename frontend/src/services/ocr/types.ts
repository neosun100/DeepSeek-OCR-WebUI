export interface OCRBox {
    label: 'title' | 'image' | 'table' | 'text' | string
    box: [number, number, number, number] // [x1, y1, x2, y2]
}

/**
 * Page-level output judgement codes emitted by the v5 backend (server judges.py).
 */
export type OCRWarningCode =
    | 'repetition'
    | 'repetition_cut'
    | 'truncated'
    | 'coordinate_loop'
    | 'bbox_invalid'
    | 'empty_output'
    | 'near_empty'

export interface OCRWarning {
    code: OCRWarningCode | string
    message: string
    [extra: string]: unknown
}

export type OCRFinishReason = 'stop' | 'length' | 'repetition_cut'

/**
 * Warning codes that mean the page output is unreliable (backend `ok === false`).
 * near_empty / bbox_invalid are informational only (a blank page legitimately has no text).
 * Intentionally duplicated; authoritative source: server/deepseek_ocr_webui/judges.py `_FAILING`.
 */
export const FAILING_WARNING_CODES: ReadonlySet<string> = new Set([
    'repetition', 'repetition_cut', 'coordinate_loop', 'truncated', 'empty_output'
])

export function isFailingWarning(w: Pick<OCRWarning, 'code'>): boolean {
    return FAILING_WARNING_CODES.has(w.code)
}

/**
 * Normalize a stored/received warnings value.
 * Dirty data source: v4 backends and OCR records saved before v5 have no `warnings` field;
 * a malformed entry would otherwise crash the page list rendering.
 */
export function normalizeWarnings(value: unknown): OCRWarning[] {
    if (!Array.isArray(value)) return []
    return value
        .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null && typeof w.code === 'string')
        .map(w => ({ ...w, code: w.code as string, message: typeof w.message === 'string' ? w.message : String(w.code) }))
}

export interface OCRResult {
    success: boolean
    text: string
    raw_text: string
    boxes: OCRBox[]
    image_dims: { w: number; h: number }
    prompt_type: string
    // v5 fields (absent on v4 backends and on records saved before v5)
    ok?: boolean
    finish_reason?: OCRFinishReason | string
    warnings?: OCRWarning[]
    content_chars?: number
    request_id?: string | null
    metadata?: Record<string, unknown>
}

export type OCRPromptType = 'document' | 'ocr' | 'free' | 'figure' | 'describe' | 'find' | 'freeform'

export interface OCROptions {
    prompt_type?: OCRPromptType
    custom_prompt?: string // used for freeform
    find_term?: string     // used for find
    grounding?: boolean    // required for all
    signal?: AbortSignal
}

export interface OCRProvider {
    name: string
    process(imageData: Blob | string, options?: OCROptions): Promise<OCRResult>
}

/**
 * Non-2xx response from the OCR API, carrying the backend's error contract
 * (v5: `{detail: {error, message, actual?, limit?}, request_id}`; v4: `{detail: string}` / `{error: string}`).
 */
export class OCRApiError extends Error {
    readonly status: number
    readonly code: string | null
    readonly backendMessage: string | null
    readonly requestId: string | null
    readonly actual: unknown
    readonly limit: unknown
    readonly retryAfterMs: number | null

    constructor(message: string, init: {
        status: number
        code?: string | null
        backendMessage?: string | null
        requestId?: string | null
        actual?: unknown
        limit?: unknown
        retryAfterMs?: number | null
    }) {
        super(message)
        this.name = 'OCRApiError'
        this.status = init.status
        this.code = init.code ?? null
        this.backendMessage = init.backendMessage ?? null
        this.requestId = init.requestId ?? null
        this.actual = init.actual
        this.limit = init.limit
        this.retryAfterMs = init.retryAfterMs ?? null
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/**
 * Backend answered 503 `model_loading`: the model is still loading / warming up.
 * Retryable — the task waits and resubmits, like a full queue.
 */
export class ModelLoadingError extends OCRApiError {
    constructor(message: string, init: ConstructorParameters<typeof OCRApiError>[1]) {
        super(message, init)
        this.name = 'ModelLoadingError'
    }
}

/**
 * Custom error thrown when the server OCR queue is full.
 */
export class QueueFullError extends Error {
    constructor(message: string = 'Server OCR queue is full') {
        super(message)
        this.name = 'QueueFullError'
        Object.setPrototypeOf(this, QueueFullError.prototype)
    }
}
