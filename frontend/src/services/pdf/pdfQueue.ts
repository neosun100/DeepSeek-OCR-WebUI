import PQueue from 'p-queue'
import { pdfEvents } from './events'
import { db, generatePageId } from '@/db/index'
import type { DBPage } from '@/db/index'
import { enhancedPdfRenderer } from './enhancedPdfRenderer'
import { queueLogger } from '@/utils/logger'
import { getRandomId } from '@/utils/crypto'
import { PAGE_RENDER_CONFIG, imageExtension, imageMimeType } from './config'

/**
 * Open PDF sources. The PDF bytes themselves live only inside the render worker (transferred
 * once on open); the main thread keeps bookkeeping so it knows when to close the document.
 */
interface PDFSource {
  totalPages: number
  processedCount: number
  fallbackFont: string
}
export const pdfSourceCache = new Map<string, PDFSource>()

// PDF page render task interface
interface PDFRenderTask {
  pageId: string
  pageNumber: number
  fileName: string
  sourceId: string // ID to look up in pdfSourceCache
}

// Create singleton queue instance
export const pdfRenderQueue = new PQueue({
  concurrency: 1, // Reduced to 1 to avoid IndexedDB lock/concurrency issues in Webkit
  autoStart: true
})

// Worker instance management
let workerInstance: Worker | null = null
let renderingTasks = new Map<string, PDFRenderTask>()

/**
 * Renders awaiting a worker reply. The queue task awaits this promise, so only one page is in
 * flight at a time (backpressure). Without it every page was posted to the worker at once and
 * rendered concurrently - N canvases plus N copies of the PDF alive at the same time.
 */
interface PendingRender {
  settle: () => void
  timer: ReturnType<typeof setTimeout>
}
const pendingRenders = new Map<string, PendingRender>()

interface OpenedDocument { numPages: number; sampleText: string }
interface PendingOpen {
  resolve: (doc: OpenedDocument) => void
  reject: (error: Error) => void
}
const pendingOpens = new Map<string, PendingOpen>()

/**
 * Initialize PDF render worker
 */
function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('../../workers/pdfRender.worker.ts', import.meta.url), {
      type: 'module'
    })

    // Handle worker messages
    workerInstance.addEventListener('message', handleWorkerMessage)

    // Handle worker errors
    workerInstance.addEventListener('error', (error) => {
      queueLogger.error('PDF Worker error:', error)
      pdfEvents.emit('pdf:processing-error', {
        file: new File([], 'unknown.pdf'),
        error: `Worker error: ${error.message}`
      })
      failPendingWork(`Worker error: ${error.message}`)
    })
  }

  return workerInstance
}

/**
 * A crashed worker never answers: fail everything in flight instead of waiting for timeouts.
 */
function failPendingWork(reason: string): void {
  for (const [docId, pending] of pendingOpens) {
    pendingOpens.delete(docId)
    pending.reject(new Error(reason))
  }
  for (const pageId of [...pendingRenders.keys()]) {
    void handleRenderError(pageId, reason)
  }
}

/**
 * Hand the PDF bytes to the worker (transferred, not copied) and wait until it has parsed them.
 * After this call `pdfData` is detached on the main thread.
 */
export function openDocumentInWorker(docId: string, pdfData: ArrayBuffer): Promise<OpenedDocument> {
  return new Promise((resolve, reject) => {
    pendingOpens.set(docId, { resolve, reject })
    getWorker().postMessage({ type: 'open', payload: { docId, pdfData } }, [pdfData])
  })
}

/**
 * Release the worker-side PDFDocumentProxy for a source
 */
function closeDocumentInWorker(docId: string): void {
  if (!workerInstance) return
  workerInstance.postMessage({ type: 'close', payload: { docId } })
}

/**
 * Resolves once the worker's reply for this page has been fully handled (success or error).
 * A page that never comes back is failed after renderTimeoutMs so the queue cannot stall.
 */
function waitForRender(pageId: string): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      const seconds = Math.round(PAGE_RENDER_CONFIG.renderTimeoutMs / 1000)
      void handleRenderError(pageId, `Render timed out after ${seconds}s`)
    }, PAGE_RENDER_CONFIG.renderTimeoutMs)
    pendingRenders.set(pageId, { settle: resolve, timer })
  })
}

function settlePendingRender(pageId: string): void {
  const pending = pendingRenders.get(pageId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingRenders.delete(pageId)
  pending.settle()
}

/**
 * Handle worker message
 */
function handleWorkerMessage(event: MessageEvent) {
  const response = event.data

  if (response.type === 'started') {
    handleRenderStarted(response.payload.pageId, response.payload.pageNumber)
    return
  }

  if (response.type === 'error') {
    handleRenderError(response.payload.pageId, response.payload.error)
    return
  }

  if (response.type === 'opened' || response.type === 'open-error') {
    const pending = pendingOpens.get(response.payload.docId)
    if (!pending) return
    pendingOpens.delete(response.payload.docId)
    if (response.type === 'opened') {
      pending.resolve({ numPages: response.payload.numPages, sampleText: response.payload.sampleText || '' })
    } else {
      pending.reject(new Error(response.payload.error))
    }
    return
  }

  if (response.type === 'closed') {
    return
  }

  if (response.pageId) {
    processWorkerSuccess(response)
  }
}

/**
 * Worker response message structure
 */
interface WorkerResponse {
  type?: 'error' | 'success'
  pageId: string
  imageBlob?: Blob
  width?: number
  height?: number
  pageNumber?: number
  fileSize?: number
  payload?: {
    pageId: string
    error: string
  }
}

/**
 * Process successful worker response
 */
function processWorkerSuccess(response: WorkerResponse) {
  // Check if we're still tracking this task
  if (!renderingTasks.has(response.pageId)) {
    queueLogger.warn(`[PDF Queue] Received response for unknown task: ${response.pageId}`)
    return
  }

  if (!response.imageBlob) {
    queueLogger.warn('[PDF Queue] Received worker response without imageBlob:', response)
    return
  }

  // Worker returns Blob directly
  handleRenderSuccess(
    response.pageId,
    response.imageBlob,
    response.width!,
    response.height!,
    response.pageNumber!,
    response.fileSize!
  )
}

/**
 * Handle render started notification from worker
 */
function handleRenderStarted(pageId: string, pageNumber: number): void {
  queueLogger.info(`[PDF Render] Starting render for pageId: ${pageId}, pageNumber: ${pageNumber}`)
}



/**
 * Generate thumbnail from Blob
 */
/**
 * Generate thumbnail from Blob
 */
export async function generateThumbnailFromBlob(
  blob: Blob,
  maxSize: number = 200
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        const { width, height } = calculateThumbnailDimensions(img.width, img.height, maxSize, maxSize)
        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)
        const thumbnailData = canvas.toDataURL('image/jpeg', 0.8)
        URL.revokeObjectURL(url)
        resolve(thumbnailData)
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for thumbnail generation'))
    }
    img.src = url
  })
}

/**
 * Handle successful page rendering
 */
async function handleRenderSuccess(
  pageId: string,
  imageBlob: Blob,
  width: number,
  height: number,
  _pageNumber: number,
  fileSize: number
): Promise<void> {
  queueLogger.info(`[PDF Success] Render success for pageId: ${pageId}`)

  try {
    const task = renderingTasks.get(pageId)!


    // Get the page from database
    const page = await db.getPage(pageId)
    if (!page) {
      queueLogger.warn(`[PDF Success] Page ${pageId} no longer in database (deleted?). Skipping remaining success logic but proceeding with cleanup.`)
    } else {
      await updatePageMetadata(page, imageBlob, width, height, fileSize)
    }

    // Update processed count and clean up cache if needed
    if (task.sourceId) {
      cleanupSourceCache(task.sourceId)
    }

    renderingTasks.delete(pageId)
    await updateOverallProgress()

  } catch (error) {
    queueLogger.error(`[PDF Error] Error handling render success for ${pageId}:`, error)
    await handleRenderError(pageId, error instanceof Error ? error.message : 'Unknown error')
  } finally {
    settlePendingRender(pageId)
  }
}

/**
 * Handle page rendering error
 */
async function handleRenderError(pageId: string, errorMessage: string): Promise<void> {
  queueLogger.info(`[PDF Error] Render error for pageId: ${pageId}, error: ${errorMessage}`)

  try {
    const task = renderingTasks.get(pageId)
    if (!task) {
      queueLogger.error(`[PDF Error] No task found for pageId: ${pageId}. Available tasks:`, Array.from(renderingTasks.keys()))
      return
    }

    // Get the page from database
    const page = await db.getPage(pageId)
    if (!page) {
      queueLogger.warn(`[PDF Error] Page ${pageId} no longer in database (deleted?). Cleaning up task.`)
      // Still need to perform cleanup below
    } else {
      // Add error log to page
      const errorLog = {
        id: Date.now().toString(),
        timestamp: new Date(),
        level: 'error' as const,
        message: `Rendering failed: ${errorMessage}`,
        details: {
          pageNumber: task.pageNumber,
          fileName: task.fileName,
          error: errorMessage
        }
      }

      // Update page with error status
      const updatedPage: DBPage = {
        ...page,
        status: 'error',
        updatedAt: new Date(),
        logs: [...page.logs, errorLog]
      }

      // Save to database
      await db.savePage(updatedPage)

      // Emit error event
      pdfEvents.emit('pdf:page:error', {
        pageId,
        error: errorMessage
      })
    }

    // Update processed count and clean up cache if needed
    if (task.sourceId) {
      cleanupSourceCache(task.sourceId)
    }

    queueLogger.info(`[PDF Error] Updated page ${pageId} with error status`)

    // Clean up
    renderingTasks.delete(pageId)
    queueLogger.info(`[PDF Error] Removed task for pageId: ${pageId}. Remaining tasks:`, Array.from(renderingTasks.keys()))

  } catch (error) {
    queueLogger.error(`[PDF Error] Error handling render error for ${pageId}:`, error)
  } finally {
    settlePendingRender(pageId)
  }
}

/**
 * Update page metadata and save to DB
 */
async function updatePageMetadata(
  page: DBPage,
  imageBlob: Blob,
  width: number,
  height: number,
  fileSize: number
): Promise<void> {
  const pageId = page.id!
  // Generate thumbnail from Blob
  // Generate thumbnail from Blob
  let thumbnailData: string
  try {
    thumbnailData = await generateThumbnailFromBlob(imageBlob, 200)
  } catch (thumbError) {
    queueLogger.warn(`[PDF Warning] Failed to generate thumbnail for ${pageId}:`, thumbError)
    thumbnailData = ''
  }

  // Save full image Blob directly to separate table
  await db.savePageImage(pageId, imageBlob)

  // Update page metadata
  const updatedPage: DBPage = {
    ...page,
    imageData: undefined,
    thumbnailData,
    width,
    height,
    fileSize,
    status: 'ready',
    progress: 100,
    updatedAt: new Date(),
    processedAt: new Date()
  }

  await db.savePage(updatedPage)

  // Emit success event
  pdfEvents.emit('pdf:page:done', {
    pageId,
    thumbnailData,
    width,
    height,
    fileSize
  })
}

/**
 * Calculate thumbnail dimensions maintaining aspect ratio
 */
function calculateThumbnailDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const widthRatio = maxWidth / originalWidth
  const heightRatio = maxHeight / originalHeight
  const ratio = Math.min(widthRatio, heightRatio, 1) // Don't upscale

  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio)
  }
}

/**
 * Helper to clean up source cache and document handle
 */
function cleanupSourceCache(sourceId: string): void {
  const source = pdfSourceCache.get(sourceId)
  if (source) {
    source.processedCount++
    if (source.processedCount >= source.totalPages) {
      pdfSourceCache.delete(sourceId)
      // Destroy the worker-side PDFDocumentProxy (it holds the parsed PDF and its bytes)
      closeDocumentInWorker(sourceId)
      queueLogger.info(`[Cleanup] All pages for source ${sourceId} processed. Document closed in worker.`)
    }
  }
}

/**
 * Update overall PDF processing progress and clean up finished files
 */
async function updateOverallProgress(): Promise<void> {
  try {
    const allPages = await db.getAllPages()
    const pdfPages = allPages.filter(page => page.origin === 'pdf_generated')

    const totalPages = pdfPages.length
    const completedPages = pdfPages.filter(page => page.status === 'ready').length
    const errorPages = pdfPages.filter(page => page.status === 'error').length

    // Emit progress event
    pdfEvents.emit('pdf:progress', {
      done: completedPages,
      total: totalPages
    })

    // Check if all PDF pages are processed
    if (totalPages > 0 && (completedPages + errorPages) === totalPages) {
      if (errorPages === 0) {
        pdfEvents.emit('pdf:processing-complete', {
          file: new File([], 'completed.pdf'), // Dummy file object
          totalPages
        })
      }
    }

    // Cleanup logic: Delete files from DB if all their pages are processed
    const fileIds = new Set<string>()
    pdfPages.forEach(p => {
      if (p.fileId) fileIds.add(p.fileId)
    })

    for (const fileId of fileIds) {
      const pagesForFile = pdfPages.filter(p => p.fileId === fileId)
      const allDone = pagesForFile.every(p => p.status === 'ready' || p.status === 'error')

      if (allDone && pagesForFile.length > 0) {
        // Verify if file still exists before trying to delete
        const file = await db.getFile(fileId)
        if (file) {
          queueLogger.info(`[Cleanup] All pages for file ${fileId} are processed. Deleting source file from DB.`)
          await db.deleteFile(fileId)
        }
      }
    }

  } catch (error) {
    queueLogger.error('Error updating overall progress:', error)
  }
}

/**
 * Queue a PDF page for rendering
 */
export async function queuePDFPageRender(task: PDFRenderTask): Promise<void> {
  queueLogger.info(`[PDF Queue] Queuing page render for pageId: ${task.pageId}, pageNumber: ${task.pageNumber}`)

  // Check if already processed
  const page = await db.getPage(task.pageId)
  if (page && (page.status === 'ready' || page.status === 'rendering')) {
    queueLogger.info(`[PDF Queue] Skipping page ${task.pageId} - status: ${page.status}`)
    return // Skip if already processed or currently rendering
  }

  // Add task to tracking map BEFORE queuing
  renderingTasks.set(task.pageId, task)

  // Add to queue without awaiting - allow multiple pages and files to queue quickly
  pdfRenderQueue.add(async () => {
    await renderPDFPage(task)
  })
}

/**
 * Render a single PDF page
 */
async function renderPDFPage(task: PDFRenderTask): Promise<void> {
  try {
    // Update page status to rendering, but check if it still exists first
    const page = await db.getPage(task.pageId)
    if (!page) {
      queueLogger.warn(`[PDF Render] Page ${task.pageId} no longer in database. Skipping render.`)
      await handleRenderError(task.pageId, 'Page deleted before rendering started')
      return
    }

    const updatedPage: DBPage = {
      ...page,
      status: 'rendering',
      progress: 50,
      updatedAt: new Date()
    }
    await db.savePage(updatedPage)

    // Emit rendering event
    pdfEvents.emit('pdf:page:rendering', { pageId: task.pageId })
    pdfEvents.emit('pdf:log', {
      pageId: task.pageId,
      message: `Rendering page ${task.pageNumber}`,
      level: 'info'
    })

    // The document must already be open in the worker (see queuePDFPages / resumeFileGroup)
    const source = pdfSourceCache.get(task.sourceId)
    if (!source) {
      throw new Error(`PDF source not open for sourceId: ${task.sourceId}`)
    }

    // Wait for the worker's reply so only one page is in flight (backpressure)
    const done = waitForRender(task.pageId)
    getWorker().postMessage({
      type: 'render',
      payload: {
        docId: task.sourceId,
        pageId: task.pageId,
        pageNumber: task.pageNumber,
        targetLongEdgePx: PAGE_RENDER_CONFIG.targetLongEdgePx,
        maxScale: PAGE_RENDER_CONFIG.maxScale,
        imageFormat: PAGE_RENDER_CONFIG.imageFormat,
        quality: PAGE_RENDER_CONFIG.quality,
        fallbackFontFamily: source.fallbackFont
      }
    })
    await done

  } catch (error) {
    queueLogger.error(`[PDF Render] Error rendering PDF page ${task.pageId}:`, error)
    await handleRenderError(task.pageId, error instanceof Error ? error.message : 'Unknown render error')
  }
}

/**
 * Open a PDF in the render worker and queue all of its pages.
 *
 * `pdfData` is transferred to the worker (detached here afterwards) and parsed exactly once;
 * every page render reuses that document. Returns the page count. Throws if the PDF cannot be
 * opened or the pages cannot be stored - nothing is left open in that case.
 */
export async function queuePDFPages(
  file: File,
  pdfData: ArrayBuffer,
  fileId?: string
): Promise<number> {
  // Generate a source ID for the cache (prefer fileId if available)
  const sourceId = fileId || `src_${getRandomId()}`

  const opened = await openDocumentInWorker(sourceId, pdfData)
  const pageCount = opened.numPages

  try {
    if (pageCount === 0) {
      throw new Error('PDF file appears to be empty or corrupted')
    }

    pdfSourceCache.set(sourceId, {
      totalPages: pageCount,
      processedCount: 0,
      fallbackFont: enhancedPdfRenderer.pickFallbackFont(opened.sampleText)
    })

    // Create pages for each PDF page - Orders will be assigned atomically in savePagesBatch
    const pagesData = createPDFPages(file, pageCount, fileId)

    // Save pages to database in a single atomic transaction to lock their orders
    const pageIds = await db.savePagesBatch(pagesData)

    // Emit event that all pages are now queued in DB
    pdfEvents.emit('pdf:pages:queued', { file, totalPages: pageCount })

    // Emit events and queue for rendering
    for (let i = 0; i < pageIds.length; i++) {
      const pageId = pageIds[i]!

      // Emit queued event so store can load the page immediately
      pdfEvents.emit('pdf:page:queued', { pageId })

      // Queue for rendering - NOT awaited to allow rapid queuing of multiple files
      queuePDFPageRender({
        pageId,
        pageNumber: i + 1,
        fileName: file.name,
        sourceId
      })
    }

    // Emit processing start event
    pdfEvents.emit('pdf:processing-start', {
      file,
      totalPages: pageCount
    })

    return pageCount
  } catch (error) {
    queueLogger.error('Error queueing PDF pages:', error)
    pdfSourceCache.delete(sourceId)
    closeDocumentInWorker(sourceId)
    throw error
  }
}

/**
 * Create DBPage objects for PDF pages (order will be assigned by database)
 */
function createPDFPages(file: File, pageCount: number, fileId: string | undefined): Omit<DBPage, 'order'>[] {
  const pages: Omit<DBPage, 'order'>[] = []
  const baseName = file.name.replace(/\.pdf$/i, '')
  const extension = imageExtension(PAGE_RENDER_CONFIG.imageFormat)
  const mimeType = imageMimeType(PAGE_RENDER_CONFIG.imageFormat)

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const pageFileName = `${baseName}_${pageNum}.${extension}`

    pages.push({
      id: generatePageId(),
      fileName: pageFileName,
      fileSize: 0,
      fileType: mimeType,
      origin: 'pdf_generated',
      status: 'pending_render',
      progress: 0,
      fileId,
      pageNumber: pageNum,
      outputs: [],
      logs: [{
        id: Date.now().toString(),
        timestamp: new Date(),
        level: 'info',
        message: `Page ${pageNum} of ${file.name} ready for rendering`
      }],
      createdAt: new Date(),
      updatedAt: new Date()
    })
  }
  return pages
}

/**
 * Resume processing of interrupted PDF pages
 */
export async function resumePDFProcessing(): Promise<void> {
  try {
    // 1. Find all incomplete PDF pages (pending_render OR rendering)
    const pendingPages = await db.getPagesByStatus('pending_render')
    const renderingPages = await db.getPagesByStatus('rendering')

    // Combine and filter for PDF generated pages, then sort by order to ensure sequential processing
    const incompletePages = [...pendingPages, ...renderingPages]
      .filter(page => page.origin === 'pdf_generated')
      .sort((a, b) => a.order - b.order)

    if (incompletePages.length === 0) {
      return
    }

    queueLogger.info(`[Resume] Found ${incompletePages.length} incomplete PDF pages to resume`)

    // 2. Group pages by fileId
    const { pagesByFileId, legacyPages } = groupPagesByFileId(incompletePages)

    // Handle legacy pages (mark as error or warn)
    if (legacyPages.length > 0) {
      await handleLegacyPages(legacyPages)
    }

    // 3. Process each file group
    for (const [fileId, pages] of pagesByFileId) {
      await resumeFileGroup(fileId, pages)
    }
  } catch (error) {
    queueLogger.error('Error resuming PDF processing:', error)
  }
}

/**
 * Group incomplete pages by their fileId
 */
function groupPagesByFileId(pages: DBPage[]): { pagesByFileId: Map<string, DBPage[]>, legacyPages: DBPage[] } {
  const pagesByFileId = new Map<string, DBPage[]>()
  const legacyPages: DBPage[] = []

  for (const page of pages) {
    if (page.fileId) {
      if (!pagesByFileId.has(page.fileId)) {
        pagesByFileId.set(page.fileId, [])
      }
      pagesByFileId.get(page.fileId)!.push(page)
    } else {
      legacyPages.push(page)
    }
  }

  return { pagesByFileId, legacyPages }
}

/**
 * Handle legacy pages without fileId (mark as error to prevent stuck state)
 */
async function handleLegacyPages(legacyPages: DBPage[]): Promise<void> {
  queueLogger.warn(`[Resume] Found ${legacyPages.length} legacy pages without fileId link`)
  // Group by filename just to log meaningful warnings
  const byName = new Map<string, DBPage[]>()
  legacyPages.forEach(p => {
    const name = p.fileName.split('_')[0] + '.pdf' // Crude guess
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push(p)
  })

  for (const [name, pages] of byName) {
    const firstPage = pages[0]
    if (firstPage && firstPage.id) {
      pdfEvents.emit('pdf:log', {
        pageId: firstPage.id,
        message: `Legacy PDF "${name}" pages cannot be auto-resumed. Please re-upload.`,
        level: 'warning'
      })
    }
    // Update status to error to stop "stuck" state
    for (const page of pages) {
      await db.savePage({ ...page, status: 'error' })
    }
  }
}

/**
 * Resume processing for a group of pages belonging to the same source file
 */
async function resumeFileGroup(fileId: string, pages: DBPage[]): Promise<void> {
  try {
    // Load file from DB
    const dbFile = await db.getFile(fileId)

    if (!dbFile) {
      queueLogger.error(`[Resume] Source file not found for fileId: ${fileId}`)
      // Mark all pages as error
      for (const page of pages) {
        pdfEvents.emit('pdf:log', {
          pageId: page.id!,
          message: `Source PDF file missing. Cannot resume processing.`,
          level: 'error'
        })
        await db.savePage({ ...page, status: 'error' })
      }
      return
    }

    queueLogger.info(`[Resume] Loaded source file "${dbFile.name}" (${dbFile.size} bytes)`)

    // Convert Blob/ArrayBuffer to ArrayBuffer safely
    const pdfData = dbFile.content instanceof ArrayBuffer
      ? dbFile.content
      : await dbFile.content.arrayBuffer()

    // Re-open the document in the worker (bytes transferred once); pages come from the DB
    let opened: OpenedDocument
    try {
      opened = await openDocumentInWorker(fileId, pdfData)
    } catch (openError) {
      const reason = openError instanceof Error ? openError.message : String(openError)
      queueLogger.error(`[Resume] Could not open source file "${dbFile.name}": ${reason}`)
      for (const page of pages) {
        await db.savePage({ ...page, status: 'error' })
      }
      return
    }

    pdfSourceCache.set(fileId, {
      totalPages: pages.length,
      processedCount: 0,
      fallbackFont: enhancedPdfRenderer.pickFallbackFont(opened.sampleText)
    })

    // Re-queue pages
    for (const page of pages) {
      await resumeSinglePage(page, dbFile.name, fileId)
    }

    queueLogger.info(`[Resume] Successfully re-queued ${pages.length} pages for "${dbFile.name}"`)

  } catch (error) {
    queueLogger.error(`[Resume] Failed to resume file ${fileId}:`, error)
  }
}

/**
 * Resume a single page's rendering task
 */
async function resumeSinglePage(page: DBPage, fileName: string, sourceId: string): Promise<void> {
  // Determine page number
  let pageNumber = page.pageNumber
  if (!pageNumber) {
    // Fallback: extract from filename (e.g. "foo_1.jpg"; pages created before v4.2 used .png)
    const match = page.fileName.match(/_(\d+)\.(?:png|jpe?g)$/)
    if (match && match[1]) pageNumber = parseInt(match[1])
  }

  if (!pageNumber) {
    queueLogger.error(`[Resume] Could not determine page number for page ${page.id}`)
    await db.savePage({ ...page, status: 'error' })
    return
  }

  // Reset status to pending if it was rendering
  if (page.status === 'rendering') {
    await db.savePage({ ...page, status: 'pending_render', progress: 0 })
  }

  // Queue render task with correctly populated sourceId
  queuePDFPageRender({
    pageId: page.id!,
    pageNumber,
    fileName: fileName,
    sourceId
  })
}

/**
 * Get queue statistics
 */
export function getQueueStats() {
  return {
    size: pdfRenderQueue.size,
    pending: pdfRenderQueue.pending,
    isPaused: pdfRenderQueue.isPaused
  }
}

/**
 * Pause/resume the queue
 */
export function pauseQueue() {
  pdfRenderQueue.pause()
}

export function resumeQueue() {
  pdfRenderQueue.start()
}

/**
 * Clear the queue (cancel): drop queued renders, release waiters and close every open
 * document in the worker so its memory is freed.
 */
export function clearQueue() {
  pdfRenderQueue.clear()
  renderingTasks.clear()
  for (const pageId of [...pendingRenders.keys()]) {
    settlePendingRender(pageId)
  }
  for (const [docId, pending] of pendingOpens) {
    pendingOpens.delete(docId)
    pending.reject(new Error('PDF processing cancelled'))
    closeDocumentInWorker(docId)
  }
  for (const sourceId of [...pdfSourceCache.keys()]) {
    pdfSourceCache.delete(sourceId)
    closeDocumentInWorker(sourceId)
  }
}