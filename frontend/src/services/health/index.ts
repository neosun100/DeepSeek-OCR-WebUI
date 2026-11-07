import { consola } from 'consola'
import { getClientId } from '@/services/clientId'
import type { HealthResponse, ServiceState } from './types'

const healthLogger = consola.withTag('Health')

export class HealthCheckService {
    private intervalId: number | null = null
    private isHealthy: boolean = true
    private state: ServiceState = 'unknown'
    private lastCheckTime: Date | null = null
    private healthInfo: HealthResponse | null = null
    private readonly checkInterval: number = 5000 // 5 seconds
    private readonly timeout: number = 60000 // 60 seconds
    private readonly apiBaseUrl: string

    constructor(apiBaseUrl: string) {
        this.apiBaseUrl = apiBaseUrl
    }

    /**
     * Start health check polling
     */
    start(): void {
        // Prevent duplicate intervals
        if (this.intervalId !== null) {
            healthLogger.warn('[HealthCheckService] Already running')
            return
        }

        healthLogger.info('[HealthCheckService] Starting health check')

        // Set a non-null value to indicate running state
        this.intervalId = 1

        // Start the polling loop
        this.pollLoop()
    }

    /**
     * Polling loop that waits for each check to complete before scheduling the next
     */
    private async pollLoop(): Promise<void> {
        // Check if service has been stopped
        if (this.intervalId === null) {
            return
        }

        // Perform health check and wait for completion
        await this.performCheck()

        // Check again if service has been stopped during the check
        if (this.intervalId === null) {
            return
        }

        // Wait for the check interval, then schedule next check
        setTimeout(() => {
            this.pollLoop()
        }, this.checkInterval)
    }

    /**
     * Stop health check polling
     */
    stop(): void {
        if (this.intervalId !== null) {
            this.intervalId = null
            healthLogger.info('[HealthCheckService] Stopped health check')
        }
    }

    /**
     * Get current health status
     */
    getStatus(): boolean {
        return this.isHealthy
    }

    /**
     * Get the detailed service state (ready / starting / error / unavailable / unknown)
     */
    getServiceState(): ServiceState {
        return this.state
    }

    /**
     * Run one check right away (e.g. when the tab becomes visible again after timers were throttled).
     * Does not start a second polling loop.
     */
    async checkNow(): Promise<void> {
        await this.performCheck()
    }

    /**
     * Get health info from last successful check
     */
    getHealthInfo(): HealthResponse | null {
        return this.healthInfo
    }

    /**
     * Get last check time
     */
    getLastCheckTime(): Date | null {
        return this.lastCheckTime
    }

    /**
     * Perform a single health check
     */
    private async performCheck(): Promise<void> {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), this.timeout)

            const response = await fetch(`${this.apiBaseUrl}/health`, {
                signal: controller.signal,
                headers: {
                    'X-Client-ID': getClientId()
                }
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                // v5 answers 503 with a JSON body while the model is loading or failed to load
                const body = await this.readBody(response)
                if (response.status === 503 && body && (body.status === 'starting' || body.status === 'error')) {
                    this.applyResponse(body.status, body)
                    return
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const data: HealthResponse = await response.json()
            this.applyResponse('ready', data)
        } catch (error) {
            // Update state
            this.lastCheckTime = new Date()

            if (this.isHealthy) {
                healthLogger.error('[HealthCheckService] OCR service is unavailable', error)
            }

            this.isHealthy = false
            this.state = 'unavailable'
            this.healthInfo = null
        }
    }

    private async readBody(response: Response): Promise<HealthResponse | null> {
        try {
            const body = await response.json()
            return body && typeof body === 'object' ? body as HealthResponse : null
        } catch {
            // Non-JSON 5xx (proxy error page) → treated as unavailable by the caller
            return null
        }
    }

    /**
     * Apply a successful exchange. 'starting' still counts as healthy so tasks can be queued
     * and wait; 'error' (model failed to load) does not.
     */
    private applyResponse(state: 'ready' | 'starting' | 'error', data: HealthResponse): void {
        this.lastCheckTime = new Date()
        const wasHealthy = this.isHealthy
        const previous = this.state
        this.state = state
        this.isHealthy = state !== 'error'
        this.healthInfo = data

        if (state === 'error') {
            if (previous !== 'error') {
                healthLogger.error('[HealthCheckService] OCR model failed to load', { load_error: data.load_error })
            }
            return
        }
        if (!wasHealthy || previous === 'error') {
            healthLogger.success('[HealthCheckService] OCR service recovered')
        }
        // Log status changes for monitoring
        if (data.status !== 'healthy' && previous !== state) {
            healthLogger.warn('[HealthCheckService] OCR service status', { status: data.status })
        }
    }
}

export type { HealthResponse, HealthStatus, ServiceState, EngineInfo } from './types'
