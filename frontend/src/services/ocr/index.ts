// OCR Service: queues page OCR tasks and drives them through the provider with retry logic

import { DeepSeekOCRProvider } from './providers'
export * from './types'
import type { OCRProvider, OCRResult, OCROptions } from './types'
import { ModelLoadingError, QueueFullError } from './types'

import { db } from '@/db'
import { ocrEvents } from './events'
import { queueManager } from '@/services/queue'
import { useHealthStore } from '@/stores/health'
import { consola } from 'consola'

const ocrLogger = consola.withTag('OCR')

/** Statuses of pages whose OCR was in flight and must be resumed after an interruption. */
const RESUME_STATUSES = ['pending_ocr', 'recognizing']

/** Transient network failures (fetch TypeError) retried before the page is marked as failed. */
const MAX_NETWORK_RETRIES = 3

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * fetch() rejects with a TypeError on network-level failures ("Failed to fetch" / "Load failed" /
 * "NetworkError ..."). Browsers drop or freeze connections of background tabs (issue #47), so
 * these are treated as transient.
 */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError
}

export interface ResumeStats {
  resumed: number
  skipped: number
  missingImage: number
}

export class OCRService {
  private providers: Map<string, OCRProvider> = new Map()
  /** pageId → token of the task queued by this service; used to find orphaned pages on resume */
  private inflight: Map<string, symbol> = new Map()
  private visibilityWaiters: Set<() => void> = new Set()

  constructor() {
    this.registerProvider('deepseek', new DeepSeekOCRProvider())
  }

  registerProvider(name: string, provider: OCRProvider) {
    this.providers.set(name, provider)
  }

  /**
   * Whether this service currently has a queued/running task for the page.
   */
  isInFlight(pageId: string): boolean {
    return this.inflight.has(pageId)
  }

  /**
   * Queue an OCR task for a page
   */
  async queueOCR(
    pageId: string,
    imageData: Blob | string,
    options?: OCROptions
  ): Promise<void> {
    // Check OCR service availability before queuing.
    // isHealthy is true while the model is still loading ('starting'): the task is queued and waits.
    const healthStore = useHealthStore()

    if (!healthStore.isHealthy) {
      const error = healthStore.isModelError
        ? new Error(`OCR model is unavailable: ${healthStore.loadError || 'model failed to load'}`)
        : new Error('OCR service is currently unavailable. Please try again later.')
      ocrEvents.emit('ocr:error', { pageId, error })
      throw error
    }

    ocrEvents.emit('ocr:queued', { pageId })

    const token = Symbol(pageId)
    this.inflight.set(pageId, token)

    // Fire and forget - processing happens in queue
    queueManager.addOCRTask(pageId, async (signal) => {
      try {
        await this.processOCRWithRetry(pageId, imageData, options, signal)
      } finally {
        if (this.inflight.get(pageId) === token) this.inflight.delete(pageId)
      }
    }).catch(err => {
      if (this.inflight.get(pageId) === token) this.inflight.delete(pageId)
      ocrLogger.error(`[OCRService] Task error for ${pageId}:`, err)
    })
  }

  /**
   * Process OCR with automatic retry on queue full
   */
  private async processOCRWithRetry(
    pageId: string,
    imageData: Blob | string,
    options: OCROptions | undefined,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) return

    ocrEvents.emit('ocr:start', { pageId })

    await this.executeWithRetry(pageId, imageData, options, signal)
  }

  /**
   * Execute OCR with retry logic
   */
  private async executeWithRetry(
    pageId: string,
    imageData: Blob | string,
    options: OCROptions | undefined,
    signal: AbortSignal
  ): Promise<void> {
    const retryInterval = 5000
    const healthStore = useHealthStore()
    const attempt = { networkFailures: 0 }

    while (true) {
      if (signal.aborted) return

      if (healthStore.isFull) {
        ocrLogger.info(`[OCRService] Server queue is full, waiting ${retryInterval}ms for page ${pageId}`)
        await this.delayWithSignal(retryInterval, signal)
        continue
      }

      if (healthStore.isStarting) {
        ocrLogger.info(`[OCRService] OCR model is loading, waiting ${retryInterval}ms for page ${pageId}`)
        await this.delayWithSignal(retryInterval, signal)
        continue
      }

      const shouldContinue = await this.tryProcessOCR(pageId, imageData, options, signal, retryInterval, attempt)
      if (!shouldContinue) return
    }
  }

  /**
   * Try to process OCR, returns true if should retry
   */
  private async tryProcessOCR(
    pageId: string,
    imageData: Blob | string,
    options: OCROptions | undefined,
    signal: AbortSignal,
    retryInterval: number,
    attempt: { networkFailures: number }
  ): Promise<boolean> {
    try {
      const result = await this.processImage(imageData, 'deepseek', { ...options, signal })
      if (signal.aborted) return false

      await db.savePageOCR({ pageId, data: result, createdAt: new Date() })
      ocrEvents.emit('ocr:success', { pageId, result })
      return false
    } catch (error) {
      if (signal.aborted) return false
      return this.handleAttemptError(pageId, error, signal, retryInterval, attempt)
    }
  }

  /**
   * Decide whether a failed attempt is retried (returns true) or reported as page error (throws).
   */
  private async handleAttemptError(
    pageId: string,
    error: unknown,
    signal: AbortSignal,
    retryInterval: number,
    attempt: { networkFailures: number }
  ): Promise<boolean> {
    if (error instanceof QueueFullError) {
      ocrLogger.warn(`[OCRService] OCR task for page ${pageId} failed with 429, retrying in ${retryInterval}ms...`)
      await this.delayWithSignal(retryInterval, signal)
      return true
    }

    if (error instanceof ModelLoadingError) {
      const wait = error.retryAfterMs ?? retryInterval
      ocrLogger.warn(`[OCRService] OCR model still loading (503) for page ${pageId}, retrying in ${wait}ms...`)
      await this.delayWithSignal(wait, signal)
      return true
    }

    if (isNetworkError(error)) {
      if (isDocumentHidden()) {
        // Background tab: the browser may have dropped the connection. Do not burn a retry,
        // wait until the user is back and resubmit (issue #47).
        ocrLogger.warn(`[OCRService] Network error for page ${pageId} while tab hidden; retrying when visible`, error)
        await this.waitForVisible(signal)
        return true
      }
      if (attempt.networkFailures < MAX_NETWORK_RETRIES) {
        attempt.networkFailures++
        ocrLogger.warn(
          `[OCRService] Network error for page ${pageId}, retry ${attempt.networkFailures}/${MAX_NETWORK_RETRIES} in ${retryInterval}ms`,
          error
        )
        await this.delayWithSignal(retryInterval, signal)
        return true
      }
    }

    const err = error instanceof Error ? error : new Error(String(error))
    ocrEvents.emit('ocr:error', { pageId, error: err })
    throw err
  }

  /**
   * Helper to wait for a specific duration while respecting an AbortSignal
   */
  private delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }

      const timer = setTimeout(resolve, ms)

      const onAbort = () => {
        clearTimeout(timer)
        resolve()
      }

      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Resolve when the document is visible again (signalled by notifyVisible) or on abort.
   */
  private waitForVisible(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted || !isDocumentHidden()) {
        resolve()
        return
      }
      const done = () => {
        this.visibilityWaiters.delete(done)
        signal.removeEventListener('abort', done)
        resolve()
      }
      this.visibilityWaiters.add(done)
      signal.addEventListener('abort', done, { once: true })
    })
  }

  /**
   * Wake tasks that were waiting for the tab to become visible.
   */
  notifyVisible(): void {
    for (const wake of [...this.visibilityWaiters]) wake()
  }

  /**
   * Called when the tab becomes visible again (App.vue `visibilitychange`, issue #47):
   * 1. wake tasks parked on a background network error,
   * 2. refresh health right away (background timers were throttled, the state may be stale),
   * 3. re-queue pages still marked pending/recognizing that no longer have a task
   *    (e.g. the task was lost while the tab was frozen).
   */
  async resumeOnVisible(pages: Array<{ id: string; status: string }>): Promise<ResumeStats> {
    this.notifyVisible()

    const healthStore = useHealthStore()
    try {
      await healthStore.checkNow()
    } catch (error) {
      // Resume still proceeds; queueOCR re-checks availability with the last known state
      ocrLogger.warn('[OCRService] Health re-check on visibility failed, using last known state', error)
    }

    const orphans = pages.filter(p => RESUME_STATUSES.includes(p.status) && !this.isInFlight(p.id))
    const stats = await this.resumePages(orphans)
    stats.skipped += pages.length - orphans.length
    if (stats.resumed > 0 || stats.missingImage > 0) {
      ocrLogger.info('[OCRService] Resumed OCR after tab became visible', stats)
    }
    return stats
  }

  async processImage(
    imageData: Blob | string,
    providerName: string = 'deepseek',
    options?: OCROptions
  ): Promise<OCRResult> {
    const provider = this.providers.get(providerName)
    if (!provider) {
      throw new Error(`OCR provider '${providerName}' not found`)
    }

    return await provider.process(imageData, options)
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys())
  }

  /**
   * Queue multiple pages for batch OCR processing
   * Skips pages that are currently in the OCR queue (pending or processing)
   * Allows re-OCR of pages that have already completed OCR
   * @param pages - Array of pages with id and status
   * @returns Statistics about queued, skipped, and failed pages
   */
  async queueBatchOCR(
    pages: Array<{ id: string; status: string }>
  ): Promise<{ queued: number; skipped: number; failed: number }> {
    let queued = 0
    let skipped = 0
    let failed = 0

    // Skip only pages that are currently being processed in the OCR queue
    const skipStatuses = [
      'pending_ocr',      // Already queued
      'recognizing'       // Currently processing OCR
    ]

    for (const page of pages) {
      const status = page.status

      // Skip if page is in a skip status
      if (skipStatuses.includes(status)) {
        skipped++
        continue
      }

      // Try to queue the page (ready or error status)
      try {
        const imageBlob = await db.getPageImage(page.id)
        if (imageBlob) {
          await this.queueOCR(page.id, imageBlob, {
            prompt_type: 'document'
          })
          queued++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }

    return { queued, skipped, failed }
  }

  /**
   * Resume interrupted OCR tasks on startup
   * Retries pages that were in 'pending_ocr' or 'recognizing' state
   * @param pages - Array of pages with id and status
   */
  async resumeBatchOCR(
    pages: Array<{ id: string; status: string }>
  ): Promise<ResumeStats> {
    const targets = pages.filter(p => RESUME_STATUSES.includes(p.status))
    const stats = await this.resumePages(targets)
    stats.skipped += pages.length - targets.length
    return stats
  }

  /**
   * Re-queue the given pages. A page whose image is gone is reported as an explicit
   * page error instead of being skipped silently (it would otherwise stay "pending" forever).
   */
  private async resumePages(pages: Array<{ id: string; status: string }>): Promise<ResumeStats> {
    const stats: ResumeStats = { resumed: 0, skipped: 0, missingImage: 0 }

    for (const page of pages) {
      try {
        const imageBlob = await db.getPageImage(page.id)
        if (!imageBlob) {
          stats.missingImage++
          const error = new Error('Cannot resume OCR: page image is missing from local storage. Please re-import the file.')
          ocrLogger.error(`[OCRService] Resume failed for ${page.id}: image missing`)
          ocrEvents.emit('ocr:error', { pageId: page.id, error })
          continue
        }
        await this.queueOCR(page.id, imageBlob, {
          prompt_type: 'document'
        })
        stats.resumed++
      } catch (error) {
        // queueOCR already emitted ocr:error for availability failures
        stats.skipped++
        ocrLogger.error(`[OCRService] Failed to resume task for ${page.id}:`, error)
      }
    }

    return stats
  }
}

export const ocrService = new OCRService()
