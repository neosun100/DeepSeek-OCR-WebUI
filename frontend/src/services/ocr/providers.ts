import { config } from '@/config'
import { getClientId } from '@/services/clientId'
import { ocrLogger } from '@/utils/logger'
import { ModelLoadingError, OCRApiError, QueueFullError, normalizeWarnings } from './types'
import type { OCRProvider, OCRResult, OCROptions } from './types'

/**
 * Error body fields extracted from any backend generation.
 */
export interface ParsedErrorBody {
    code: string | null
    message: string | null
    actual?: unknown
    limit?: unknown
    requestId: string | null
}

/**
 * Parse an error response body. Handles, in order:
 * - v5: `{success:false, detail:{error, message, actual?, limit?}, request_id}`
 * - v4: `{detail: "string"}` (FastAPI HTTPException) or `{success:false, error:"string"}`
 * Anything else (HTML proxy page, empty body) yields nulls so the caller falls back to the status line.
 */
export function parseErrorBody(body: unknown): ParsedErrorBody {
    const out: ParsedErrorBody = { code: null, message: null, requestId: null }
    if (!body || typeof body !== 'object') return out
    const b = body as Record<string, unknown>
    if (typeof b.request_id === 'string') out.requestId = b.request_id

    Object.assign(out, parseDetail(b.detail))
    if (!out.message && typeof b.error === 'string') out.message = b.error
    return out
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function parseDetail(detail: unknown): Partial<ParsedErrorBody> {
    if (typeof detail === 'string') return { message: detail }
    if (Array.isArray(detail)) {
        // FastAPI default 422 shape: [{loc, msg, type}]
        const first = detail[0] as Record<string, unknown> | undefined
        return { message: str(first?.msg) }
    }
    if (detail && typeof detail === 'object') {
        const d = detail as Record<string, unknown>
        return { code: str(d.error), message: str(d.message), actual: d.actual, limit: d.limit }
    }
    return {}
}

function parseRetryAfter(response: Response): number | null {
    const raw = response.headers?.get?.('Retry-After')
    if (!raw) return null
    const seconds = Number(raw)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

/**
 * Map the raw API response to OCRResult. v5 judgement fields are only set when present,
 * so v4 responses map exactly as before.
 */
export function mapOCRResponse(result: Record<string, unknown>): OCRResult {
    const mapped: OCRResult = {
        success: result.success as boolean,
        text: result.text as string,
        raw_text: result.raw_text as string,
        boxes: (result.boxes as OCRResult['boxes']) || [],
        image_dims: (result.image_dims as OCRResult['image_dims']) || { w: 0, h: 0 },
        prompt_type: result.prompt_type as string
    }
    if (typeof result.ok === 'boolean') mapped.ok = result.ok
    if (typeof result.finish_reason === 'string') mapped.finish_reason = result.finish_reason
    if (result.warnings !== undefined) mapped.warnings = normalizeWarnings(result.warnings)
    if (typeof result.content_chars === 'number') mapped.content_chars = result.content_chars
    if (typeof result.request_id === 'string') mapped.request_id = result.request_id
    if (result.metadata && typeof result.metadata === 'object') {
        mapped.metadata = result.metadata as Record<string, unknown>
    }
    return mapped
}

async function readJsonSafely(response: Response): Promise<unknown> {
    if (typeof response.json !== 'function') return null
    try {
        return await response.json()
    } catch {
        // Non-JSON error body (e.g. proxy HTML page): fall back to the status line
        return null
    }
}

export class DeepSeekOCRProvider implements OCRProvider {
    name = 'deepseek'

    private async createFormData(imageData: Blob | string, options?: OCROptions): Promise<FormData> {
        const formData = new FormData()

        // Handle both Blob (from file/canvas) and base64 string (legacy/other sources)
        if (imageData instanceof Blob) {
            formData.append('file', imageData, 'image.jpg')
        } else {
            const blob = await (await fetch(imageData)).blob()
            formData.append('file', blob, 'image.jpg')
        }

        const promptType = options?.prompt_type || 'document'
        formData.append('prompt_type', promptType)

        if (options?.custom_prompt && promptType === 'freeform') {
            formData.append('custom_prompt', options.custom_prompt)
        }

        if (options?.find_term && promptType === 'find') {
            formData.append('find_term', options.find_term)
        }

        const grounding = this.resolveGrounding(options, promptType)
        formData.append('grounding', String(grounding))

        return formData
    }

    private resolveGrounding(options: OCROptions | undefined, promptType: string): boolean {
        if (options?.grounding !== undefined) return options.grounding
        return ['document', 'ocr', 'find'].includes(promptType)
    }

    private rateLimitError(parsed: ParsedErrorBody): Error {
        // v5 machine code first; v4 phrases are still contained in the v5 message too
        const code = parsed.code
        const msg = parsed.message || ''

        if (code === 'queue_full' || msg.includes('queue full')) {
            return new QueueFullError('Queue Full: Server queue just filled up, please try again later.')
        }
        if (code === 'client_limit' || msg.includes('Client at max')) {
            return new Error('Client Limit: You already have a task in progress.')
        }
        if (code === 'ip_limit' || msg.includes('IP at max')) {
            return new Error('IP Limit: Too many requests from your network.')
        }
        return new Error(`Rate Limit Exceeded: ${msg}`)
    }

    /**
     * Map a non-2xx response to an error whose message includes the backend's explanation
     * (issue #39: previously only "500 Internal Server Error" reached the user).
     */
    private async toResponseError(response: Response): Promise<Error> {
        const parsed = parseErrorBody(await readJsonSafely(response))

        if (response.status === 429) return this.rateLimitError(parsed)

        const init = {
            status: response.status,
            code: parsed.code,
            backendMessage: parsed.message,
            requestId: parsed.requestId,
            actual: parsed.actual,
            limit: parsed.limit,
            retryAfterMs: parseRetryAfter(response)
        }
        const statusLine = `OCR API Error: ${response.status} ${response.statusText || ''}`.trimEnd()
        const message = parsed.message ? `${statusLine}: ${parsed.message}` : statusLine

        if (response.status === 503 && parsed.code === 'model_loading') {
            return new ModelLoadingError(message, init)
        }
        return new OCRApiError(message, init)
    }

    private handleProcessError(error: unknown, endpoint: string, options?: OCROptions): never {
        if (error instanceof Error && error.name === 'AbortError') {
            throw error
        }

        // Don't log retryable errors; the service retry logic handles them
        if (error instanceof QueueFullError || error instanceof ModelLoadingError) {
            throw error
        }

        ocrLogger.error('[DeepSeekOCRProvider] Process failed:', {
            endpoint,
            error,
            options
        })

        if (error instanceof Error) {
            throw error
        }
        throw new Error('Unknown error during OCR processing')
    }

    async process(imageData: Blob | string, options?: OCROptions): Promise<OCRResult> {
        const formData = await this.createFormData(imageData, options)

        try {
            // Construct the full URL by appending the specific endpoint
            const url = `${config.apiBaseUrl}/ocr`
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                signal: options?.signal,
                headers: {
                    'X-Client-ID': getClientId()
                }
            })

            if (!response.ok) {
                throw await this.toResponseError(response)
            }

            const result = await response.json()

            return mapOCRResponse(result)
        } catch (error) {
            return this.handleProcessError(error, `${config.apiBaseUrl}/ocr`, options)
        }
    }
}
