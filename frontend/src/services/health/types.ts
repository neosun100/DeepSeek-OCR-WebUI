/**
 * Backend status. v5 adds 'starting' (model loading / warm-up, HTTP 503) and
 * 'error' (model load failed, HTTP 503 + load_error).
 */
export type HealthStatus = 'healthy' | 'busy' | 'full' | 'starting' | 'error'

/**
 * Client-side service state derived from the /health exchange:
 * - ready: 2xx, model loaded (status healthy | busy | full)
 * - starting: 503 + status 'starting' → tasks may queue and wait
 * - error: 503 + status 'error' → model failed to load, reject new tasks
 * - unavailable: network failure, timeout, or a non-2xx without a v5 body
 * - unknown: no check completed yet (optimistic, same as v4 default)
 */
export type ServiceState = 'unknown' | 'ready' | 'starting' | 'error' | 'unavailable'

export interface EngineInfo {
    engine?: string
    device?: string | null
    dtype?: string | null
    [extra: string]: unknown
}

export interface HealthResponse {
    status: HealthStatus
    backend: string | null
    platform?: string
    model_loaded: boolean
    // v5 fields (absent on v4 backends)
    ready?: boolean
    version?: string
    model_version?: string
    model_id?: string
    model_revision?: string | null
    engine?: EngineInfo
    load_error?: string | null
    warmup?: { ok?: boolean; recall?: number; [extra: string]: unknown }
    inflight?: number
    // Original queue fields for backward compatibility/simple display
    ocr_queue?: {
        depth: number
        max_size: number
        is_full: boolean
    }
    // New rate limiting fields
    rate_limits?: {
        max_per_client: number
        max_per_ip: number
        active_clients: number
        active_ips: number
    }
    // New personalized queue status
    your_queue_status?: {
        client_id: string
        position: number | null
        total_queued: number
    }
}

export interface HealthCheckState {
    isHealthy: boolean
    lastCheckTime: Date | null
    healthInfo: HealthResponse | null
    error: Error | null
}

export type RateLimitReason = 'queue_full' | 'client_limit' | 'ip_limit' | 'unknown'
