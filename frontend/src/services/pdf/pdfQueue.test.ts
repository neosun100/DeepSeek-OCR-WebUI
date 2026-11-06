import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  queuePDFPages,
  queuePDFPageRender,
  resumePDFProcessing,
  getQueueStats,
  pauseQueue,
  resumeQueue,
  clearQueue,
  pdfSourceCache
} from '@/services/pdf/pdfQueue'
import { PAGE_RENDER_CONFIG } from '@/services/pdf/config'
import { db } from '@/db/index'
import { pdfEvents } from '@/services/pdf/events'
import { queueLogger } from '@/utils/logger'

// 1. Mocks
(globalThis as any).pageIdCounter = 0
vi.mock('@/db/index', () => ({
  db: {
    getNextOrder: vi.fn().mockResolvedValue(1),
    savePage: vi.fn(),
    getPage: vi.fn(),
    savePageImage: vi.fn(),
    getAllPages: vi.fn().mockResolvedValue([]),
    getPagesByStatus: vi.fn().mockResolvedValue([]),
    getFile: vi.fn(),
    deleteFile: vi.fn(),
    savePagesBatch: vi.fn().mockImplementation(async (pages) => pages.map((p: any) => p.id)),
  },
  generatePageId: () => `page-id-${++(globalThis as any).pageIdCounter}`
}))

vi.mock('@/services/pdf/events', () => ({
  pdfEvents: { emit: vi.fn() }
}))

vi.mock('@/services/pdf/enhancedPdfRenderer', () => ({
  enhancedPdfRenderer: {
    pickFallbackFont: vi.fn().mockReturnValue('sans-serif')
  }
}))

vi.mock('@/utils/logger', () => ({
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('p-queue', () => {
  return {
    default: class MockPQueue {
      _queue: unknown[] = []
      size = 0
      pending = 0
      isPaused = false
      concurrency = 2
      constructor(opts: Record<string, unknown>) { if (opts.concurrency) this.concurrency = opts.concurrency as number }
      async add(fn: (...args: unknown[]) => unknown) {
        this.size++; this.pending++
        try { await fn() } finally { this.pending--; this.size-- }
      }
      pause() { this.isPaused = true }
      start() { this.isPaused = false }
      clear() { this.size = 0; this.pending = 0 }
    }
  }
})

// 2. Global state for mocks
let mockWorkerResponseCallback: ((worker: unknown, data: unknown) => void) | undefined
let mockWorkerLastMessage: unknown
let lastWorkerInstance: Worker | null = null
// All messages posted to the worker, with their transfer lists
let workerMessages: { data: any; transfer: unknown[] }[] = []
// What the fake worker answers to 'open': page count or an error message
let mockOpenReply: { numPages: number; sampleText?: string } | { error: string } = { numPages: 1 }

class MockWorker {
  onmessage: ((ev: MessageEvent) => unknown) | null = null
  onerror: ((this: Worker, ev: ErrorEvent) => unknown) | null = null
  listeners: Record<string, unknown[]> = {}
  constructor() { lastWorkerInstance = this as unknown as Worker }
  postMessage(data: unknown, transfer: unknown[] = []) {
    mockWorkerLastMessage = data
    workerMessages.push({ data, transfer })
    const msg = data as { type: string; payload: { docId: string } }
    if (msg.type === 'open') {
      // Simulate the real transfer: the sender's buffer is detached
      structuredClone(data, { transfer } as Parameters<typeof structuredClone>[1])
      const reply = 'error' in mockOpenReply
        ? { type: 'open-error', payload: { docId: msg.payload.docId, error: mockOpenReply.error } }
        : { type: 'opened', payload: { docId: msg.payload.docId, ...mockOpenReply } }
      setTimeout(() => this.trigger('message', { data: reply }), 0)
      return
    }
    if (msg.type === 'close') {
      setTimeout(() => this.trigger('message', { data: { type: 'closed', payload: { docId: msg.payload.docId } } }), 0)
      return
    }
    setTimeout(() => { if (mockWorkerResponseCallback) mockWorkerResponseCallback(this, data) }, 0)
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(listener)
    if (type === 'message') this.onmessage = listener as ((ev: MessageEvent) => unknown) | null
    if (type === 'error') this.onerror = listener as ((this: Worker, ev: ErrorEvent) => unknown) | null
  }
  trigger(type: string, data: unknown) {
    if (this.listeners[type]) this.listeners[type].forEach(l => (l as (d: unknown) => void)(data))
  }
  terminate() { }
}

const originalWorker = globalThis.Worker
const originalURL = globalThis.URL
const originalImage = globalThis.Image

describe('pdfQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).pageIdCounter = 0
    setupDefaultDbMocks()
    setupGlobalMocks()
  })

  afterEach(() => {
    globalThis.Worker = originalWorker
    globalThis.URL = originalURL
    globalThis.Image = originalImage
    clearQueue()
  })

  it('queuePDFPages: should create pages and add to queue', async () => {
    const { file, pdfData } = getTestData()
    vi.mocked(db.savePage).mockResolvedValue('page-id-1')
    mockOpenReply = { numPages: 2 }
    await queuePDFPages(file, pdfData, 'file-id-1')
    expect(db.savePagesBatch).toHaveBeenCalled()
    await new Promise(res => setTimeout(res, 50))
    expect(pdfEvents.emit).toHaveBeenCalledWith('pdf:processing-start', expect.anything())
    expect(mockWorkerLastMessage).toBeDefined()
  })

  it('render: should handle success', async () => {
    const { file, pdfData } = getTestData()
    vi.mocked(db.savePage).mockResolvedValueOnce('page-id-1')
    vi.mocked(db.getPage).mockResolvedValue({ id: 'page-id-1', status: 'pending_render', logs: [] } as unknown as import("@/db").DBPage)

    mockWorkerResponseCallback = (worker, req) => {
      const request = req as any
      if (request.type === 'render') {
        // @ts-expect-error: accessing private/protected property for testing
        worker.onmessage({
          data: {
            pageId: request.payload.pageId, imageBlob: new Blob(['img']),
            width: 100, height: 100, pageNumber: 1, fileSize: 1000
          }
        })
      }
    }

    mockOpenReply = { numPages: 1 }
    await queuePDFPages(file, pdfData, 'file-id-1')
    await new Promise(res => setTimeout(res, 50))
    expect(db.savePageImage).toHaveBeenCalled()
    expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
  })

  it('render: should handle worker error', async () => {
    const { file, pdfData } = getTestData()
    vi.mocked(db.savePage).mockResolvedValueOnce('page-id-err')
    vi.mocked(db.getPage).mockResolvedValue({ id: 'page-id-err', status: 'pending_render', logs: [] } as unknown as import("@/db").DBPage)

    mockWorkerResponseCallback = (worker, req) => {
      const request = req as any
      if (request.type === 'render') {
        // @ts-expect-error: accessing private/protected property for testing
        worker.onmessage({
          data: {
            type: 'error', payload: { pageId: request.payload.pageId, error: 'Fail' }
          }
        })
      }
    }

    mockOpenReply = { numPages: 1 }
    await queuePDFPages(file, pdfData, 'file-id-err')
    await new Promise(res => setTimeout(res, 50))
    expect(pdfEvents.emit).toHaveBeenCalledWith('pdf:page:error', expect.anything())
    expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
  })

  it('worker: should handle started message', async () => {
    await queuePDFPageRender({ pageId: 'p-started', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    expect(lastWorkerInstance).toBeTruthy()

    // Simulate Worker sending started message
    // @ts-expect-error: mocking internal onmessage call
    lastWorkerInstance.onmessage({
      data: {
        type: 'started',
        payload: {
          pageId: 'p-started',
          pageNumber: 1
        }
      }
    } as any)

    await vi.waitFor(() => {
      expect(queueLogger.info).toHaveBeenCalledWith(
        '[PDF Render] Starting render for pageId: p-started, pageNumber: 1'
      )
    })
  })

  it('worker: should warn if success response has no imageBlob', async () => {
    await queuePDFPageRender({ pageId: 'p-no-blob', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    expect(lastWorkerInstance).toBeTruthy()
    // @ts-expect-error: mocking internal onmessage call
    lastWorkerInstance.onmessage({
      data: { type: 'success', pageId: 'p-no-blob' }
    } as any)
    await vi.waitFor(() => {
      expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('without imageBlob'), expect.anything())
    })
  })

  it('edge: handle missing task during success (race condition)', async () => {
    await queuePDFPageRender({ pageId: 'p-race', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    // @ts-expect-error: mocking internal onmessage call
    lastWorkerInstance.onmessage({
      data: { type: 'success', pageId: 'p-ghost', imageBlob: new Blob([]) }
    } as any)
    await vi.waitFor(() => {
      expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown task'))
    })
  })

  it('edge: handle missing task during error (race condition)', async () => {
    await queuePDFPageRender({ pageId: 'p-race-err', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    // @ts-expect-error: mocking internal onmessage call
    lastWorkerInstance.onmessage({
      data: { type: 'error', payload: { pageId: 'p-ghost-err', error: 'foo' } }
    } as any)
    await vi.waitFor(() => {
      expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('No task found'), expect.anything())
    })
  })

  it('edge: handle missing page during error', async () => {
    await queuePDFPageRender({ pageId: 'p-err-gone', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    vi.mocked(db.getPage).mockResolvedValue(undefined)
    // @ts-expect-error: mocking internal onmessage call
    lastWorkerInstance.onmessage({
      data: { type: 'error', payload: { pageId: 'p-err-gone', error: 'boom' } }
    } as any)
    await vi.waitFor(() => {
      expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no longer in database'))
    })
  })

  it('resume: should re-queue incomplete pages', async () => {
    const incompletePage = { id: 'p1', fileId: 'f1', status: 'pending_render', pageNumber: 1, origin: 'pdf_generated', order: 10 }
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce([incompletePage as unknown as import("@/db").DBPage, { ...incompletePage, id: 'p2', order: 20 } as unknown as import("@/db").DBPage]).mockResolvedValueOnce([])
    vi.mocked(db.getFile).mockResolvedValue({
      name: 't.pdf',
      content: { arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob,
      size: 100
    } as unknown as import("@/db").DBFile)
    vi.mocked(db.getPage).mockResolvedValue(incompletePage as unknown as import("@/db").DBPage)

    await resumePDFProcessing()
    expect(db.getFile).toHaveBeenCalledWith('f1')
    await new Promise(res => setTimeout(res, 100))
    expect(queueLogger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded source file'))
  })

  it('resume: should return early if no incomplete pages', async () => {
    vi.mocked(db.getPagesByStatus).mockResolvedValue([])
    await resumePDFProcessing()
    expect(queueLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('Found'))
  })

  it('queue: DB failure after open closes the document again and rethrows', async () => {
    vi.mocked(db.savePagesBatch).mockRejectedValue(new Error('Order failed'))
    await expect(queuePDFPages(new File([], 'f.pdf'), new ArrayBuffer(10), 'f-db')).rejects.toThrow('Order failed')
    expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error queueing'), expect.anything())
    expect(workerMessages.map(m => m.data.type)).toEqual(['open', 'close'])
    expect(workerMessages[1]!.data.payload.docId).toBe('f-db')
  })

  it('global: should handle error in updateOverallProgress', async () => {
    vi.mocked(db.getAllPages).mockRejectedValue(new Error('Progress fail'))

    await queuePDFPageRender({ pageId: 'p-prog', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    expect(lastWorkerInstance).toBeTruthy()

    // @ts-expect-error: mocking internal calling
    lastWorkerInstance.onmessage({
      data: { type: 'success', pageId: 'p-prog', imageBlob: new Blob([]), width: 100, height: 100, pageNumber: 1, fileSize: 1000 }
    } as any)

    await vi.waitFor(() => {
      expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error updating overall progress'), expect.anything())
    })
  })

  it('resume: should handle errors in resumePDFProcessing', async () => {
    vi.mocked(db.getPagesByStatus).mockRejectedValue(new Error('Resume fail'))
    await resumePDFProcessing()
    expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error resuming'), expect.anything())
  })

  it('resume: should handle error in resumeFileGroup', async () => {
    const pages = [{ id: 'p1', fileId: 'f-err', origin: 'pdf_generated' }]
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce(pages as any).mockResolvedValueOnce([])
    vi.mocked(db.getFile).mockRejectedValue(new Error('File load fail'))

    await resumePDFProcessing()

    // We need waitFor here as well because resumeFileGroup uses promises internally
    expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to resume file'), expect.anything())
  })

  it('resume: should skip existing pages in queuePDFPageRender', async () => {
    vi.mocked(db.getPage).mockResolvedValue({ id: 'p1', status: 'ready' } as any)
    await queuePDFPageRender({ pageId: 'p1', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    expect(queueLogger.info).toHaveBeenCalledWith(expect.stringContaining('Skipping page'))
  })

  it('resume: should handle legacy pages without fileId', async () => {
    const legacyPage = { id: 'leg-p', fileName: 'foo_1.png', origin: 'pdf_generated' }
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce([legacyPage as unknown as import("@/db").DBPage]).mockResolvedValueOnce([])
    await resumePDFProcessing()
    expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('legacy pages without fileId'))
    expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
  })

  it('resume: should fail if page number cannot be determined', async () => {
    const badPage = { id: 'p-bad', fileName: 'weird.png', fileId: 'f1', origin: 'pdf_generated' }
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce([badPage as unknown as import("@/db").DBPage]).mockResolvedValueOnce([])
    vi.mocked(db.getFile).mockResolvedValue({ name: 't.pdf', content: { arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob, size: 100 } as unknown as import("@/db").DBFile)

    await resumePDFProcessing()

    expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
    expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('Could not determine page number'))
  })

  it('resume: should reset rendering status to pending_render', async () => {
    const renderingPage = { id: 'p-render', fileId: 'f1', status: 'rendering', pageNumber: 2, origin: 'pdf_generated' }
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce([]).mockResolvedValueOnce([renderingPage as unknown as import("@/db").DBPage])
    // @ts-expect-error: mock implementation mismatch
    vi.mocked(db.getFile).mockResolvedValue({ name: 't.pdf', content: { arrayBuffer: async () => new ArrayBuffer(0) }, size: 100 })

    await resumePDFProcessing()
    expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-render', status: 'pending_render' }))
  })

  it('resume: should handle missing source file', async () => {
    const incompletePage = { id: 'p-miss', fileId: 'miss', origin: 'pdf_generated' }
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce([incompletePage as unknown as import("@/db").DBPage]).mockResolvedValueOnce([])
    vi.mocked(db.getFile).mockResolvedValue(undefined)
    await resumePDFProcessing()
    expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }))
  })

  it('edge: handle missing page in DB during success', async () => {
    getTestData()
    vi.mocked(db.savePage).mockResolvedValueOnce('p-missing')
    // 1. queuePDFPageRender
    // 2. renderPDFPage
    // 3. handleRenderSuccess (missing)
    vi.mocked(db.getPage)
      .mockResolvedValueOnce({ id: 'p-missing' } as unknown as import("@/db").DBPage)
      .mockResolvedValueOnce({ id: 'p-missing' } as unknown as import("@/db").DBPage)
      .mockResolvedValueOnce(undefined)

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({ data: { pageId: 'p-missing', imageBlob: new Blob() } })
    }
    await queuePDFPageRender({ pageId: 'p-missing', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    await new Promise(res => setTimeout(res, 50))
    expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no longer in database'))
  })

  it('edge: handle missing page in DB during success callback', async () => {
    vi.mocked(db.savePage).mockResolvedValue('p-missing-success')
    // 1. Initial check (queue)
    vi.mocked(db.getPage).mockResolvedValueOnce({ id: 'p-missing-success', status: 'pending_render', logs: [] } as any)
    // 2. Render start check
    vi.mocked(db.getPage).mockResolvedValueOnce({ id: 'p-missing-success', status: 'rendering', logs: [] } as any)
    // 3. handleRenderSuccess check -> UNDEFINED to trigger line 173
    vi.mocked(db.getPage).mockResolvedValueOnce(undefined)

    const pdfQueueModule = await import('@/services/pdf/pdfQueue')
    pdfQueueModule.pdfSourceCache.set('src_mock_missing', {
      totalPages: 1,
      processedCount: 0,
      fallbackFont: 'sans-serif'
    })

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({
        data: {
          pageId: 'p-missing-success',
          imageBlob: new Blob(['img']),
          width: 100,
          height: 100,
          pageNumber: 1,
          fileSize: 1000
        }
      })
    }

    await queuePDFPageRender({ pageId: 'p-missing-success', pageNumber: 1, fileName: 'f.pdf', sourceId: 'src_mock_missing' })

    await new Promise(res => setTimeout(res, 100))
    expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping remaining success logic'))
  })

  it('edge: handle thumbnail generation failure', async () => {
    const { file, pdfData } = getTestData()
    vi.mocked(db.savePage).mockResolvedValueOnce('p-thumb-fail')
    vi.mocked(db.savePagesBatch).mockResolvedValue(['p-thumb-fail'])
    vi.mocked(db.getPage).mockResolvedValue({ id: 'p-thumb-fail', logs: [] } as unknown as import("@/db").DBPage)

    const OriginalImage = globalThis.Image
    globalThis.Image = class ErrorImage {
      onerror: ((this: any, ev: Event) => unknown) | null = null; src = ''
      constructor() { setTimeout(() => { if (this.onerror) this.onerror({} as any) }, 0) }
    } as unknown as typeof Image

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({ data: { pageId: 'p-thumb-fail', imageBlob: new Blob() } })
    }
    mockOpenReply = { numPages: 1 }
    await queuePDFPages(file, pdfData, 'f1')
    await new Promise(res => setTimeout(res, 100))
    expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to generate thumbnail'), expect.anything())
    globalThis.Image = OriginalImage
  })

  it('edge: cleanup when all pages done', async () => {
    const { file, pdfData } = getTestData()
    const pdfPage = { id: 'p1', fileId: 'f1', origin: 'pdf_generated', status: 'ready' }
    vi.mocked(db.getAllPages).mockResolvedValue([pdfPage as unknown as import("@/db").DBPage])
    vi.mocked(db.getFile).mockResolvedValue({ name: 't.pdf' } as unknown as import("@/db").DBFile)
    vi.mocked(db.savePage).mockResolvedValueOnce('p1')
    vi.mocked(db.savePagesBatch).mockResolvedValue(['p1'])
    vi.mocked(db.getPage).mockResolvedValue({ id: 'p1', status: 'pending_render', logs: [] } as unknown as import("@/db").DBPage)

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({ data: { pageId: 'p1', imageBlob: new Blob() } })
    }
    mockOpenReply = { numPages: 1 }
    await queuePDFPages(file, pdfData, 'f1')
    await new Promise(res => setTimeout(res, 100))
    expect(db.deleteFile).toHaveBeenCalledWith('f1')
    expect(pdfEvents.emit).toHaveBeenCalledWith('pdf:processing-complete', expect.anything())
  })

  it('edge: handle global worker error', async () => {
    await queuePDFPageRender({ pageId: 'p1', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    if (lastWorkerInstance) {
      // @ts-expect-error: accessing private/protected property for testing
      lastWorkerInstance.trigger('error', { message: 'Crash' })
      expect(queueLogger.error).toHaveBeenCalled()
    }
  })

  it('queue controls: should pause and resume', () => {
    pauseQueue()
    expect(getQueueStats().isPaused).toBe(true)
    resumeQueue()
    expect(getQueueStats().isPaused).toBe(false)
  })

  it('stats: return queue stats', () => {
    const stats = getQueueStats()
    expect(stats.size).toBe(0)
  })
})

describe('pdfQueue: single parse, transfer once, backpressure', () => {
  const successFor = (pageId: string) => ({
    data: { pageId, imageBlob: new Blob(['img']), width: 100, height: 100, pageNumber: 1, fileSize: 3 }
  })
  const renderMessages = () => workerMessages.filter(m => m.data.type === 'render')
  const settle = () => new Promise(res => setTimeout(res, 20))

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).pageIdCounter = 0
    setupDefaultDbMocks()
    setupGlobalMocks()
    vi.mocked(db.savePagesBatch).mockImplementation(async (pages: any[]) => pages.map(p => p.id))
  })

  afterEach(() => {
    globalThis.Worker = originalWorker
    globalThis.URL = originalURL
    globalThis.Image = originalImage
    clearQueue()
  })

  it('transfers the PDF bytes exactly once and never copies them', async () => {
    const sliceSpy = vi.spyOn(ArrayBuffer.prototype, 'slice')
    const pdfData = new ArrayBuffer(4096)
    mockOpenReply = { numPages: 3 }

    const count = await queuePDFPages(new File([''], 'doc.pdf'), pdfData, 'f-transfer')
    await settle()

    expect(count).toBe(3)
    const withBytes = workerMessages.filter(m => m.data.payload?.pdfData)
    expect(withBytes).toHaveLength(1)
    expect(withBytes[0]!.data.type).toBe('open')
    expect(withBytes[0]!.transfer).toEqual([pdfData])
    // Transferred => detached on the main thread
    expect(pdfData.byteLength).toBe(0)
    expect(sliceSpy).not.toHaveBeenCalled()
    // Render requests refer to the open document by id only
    for (const m of renderMessages()) {
      expect(m.data.payload.pdfData).toBeUndefined()
      expect(m.data.payload.docId).toBe('f-transfer')
    }
    sliceSpy.mockRestore()
  })

  it('creates JPEG-named pages and requests the configured format/size', async () => {
    mockOpenReply = { numPages: 2 }
    await queuePDFPages(new File([''], 'Book.pdf'), new ArrayBuffer(8), 'f-names')
    await settle()

    const pages = vi.mocked(db.savePagesBatch).mock.calls[0]![0] as any[]
    expect(pages.map(p => p.fileName)).toEqual(['Book_1.jpg', 'Book_2.jpg'])
    expect(pages.every(p => p.fileType === 'image/jpeg')).toBe(true)
    expect(renderMessages()[0]!.data.payload).toEqual(expect.objectContaining({
      imageFormat: 'jpeg',
      quality: PAGE_RENDER_CONFIG.quality,
      targetLongEdgePx: PAGE_RENDER_CONFIG.targetLongEdgePx,
      fallbackFontFamily: 'sans-serif'
    }))
  })

  it('rejects (and stores nothing) when the worker cannot open the PDF', async () => {
    mockOpenReply = { error: 'Invalid PDF structure' }
    await expect(queuePDFPages(new File([''], 'bad.pdf'), new ArrayBuffer(8), 'f-bad')).rejects.toThrow('Invalid PDF structure')
    expect(db.savePagesBatch).not.toHaveBeenCalled()
    expect(pdfSourceCache.has('f-bad')).toBe(false)
  })

  it('rejects a document with zero pages and closes it', async () => {
    mockOpenReply = { numPages: 0 }
    await expect(queuePDFPages(new File([''], 'empty.pdf'), new ArrayBuffer(8), 'f-empty')).rejects.toThrow('empty or corrupted')
    expect(workerMessages.map(m => m.data.type)).toEqual(['open', 'close'])
  })

  it('a queue task stays pending until the worker answers (one page in flight)', async () => {
    mockOpenReply = { numPages: 1 }
    await queuePDFPages(new File([''], 'doc.pdf'), new ArrayBuffer(8), 'f-bp')
    await settle()

    expect(renderMessages()).toHaveLength(1)
    expect(getQueueStats().pending).toBe(1)

    ;(lastWorkerInstance as any).trigger('message', successFor(renderMessages()[0]!.data.payload.pageId))
    await vi.waitFor(() => expect(getQueueStats().pending).toBe(0))
  })

  it('closes the worker document after the last page of a source is done', async () => {
    mockOpenReply = { numPages: 2 }
    await queuePDFPages(new File([''], 'doc.pdf'), new ArrayBuffer(8), 'f-done')
    await settle()

    for (const m of renderMessages()) {
      ;(lastWorkerInstance as any).trigger('message', successFor(m.data.payload.pageId))
    }
    await vi.waitFor(() => {
      expect(workerMessages.filter(m => m.data.type === 'close').map(m => m.data.payload.docId)).toEqual(['f-done'])
    })
    expect(pdfSourceCache.has('f-done')).toBe(false)
  })

  it('cancel (clearQueue) closes open documents and releases waiting renders', async () => {
    mockOpenReply = { numPages: 1 }
    await queuePDFPages(new File([''], 'doc.pdf'), new ArrayBuffer(8), 'f-cancel')
    await settle()
    expect(getQueueStats().pending).toBe(1)

    clearQueue()

    await vi.waitFor(() => expect(getQueueStats().pending).toBe(0))
    expect(workerMessages.filter(m => m.data.type === 'close').map(m => m.data.payload.docId)).toEqual(['f-cancel'])
    expect(pdfSourceCache.size).toBe(0)
  })

  it('cancel rejects an open that is still in flight', async () => {
    mockOpenReply = { numPages: 1 }
    const pending = queuePDFPages(new File([''], 'doc.pdf'), new ArrayBuffer(8), 'f-opening')
    clearQueue()
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('marks a page as error when the worker never answers (timeout)', async () => {
    const original = PAGE_RENDER_CONFIG.renderTimeoutMs
    PAGE_RENDER_CONFIG.renderTimeoutMs = 30
    try {
      mockOpenReply = { numPages: 1 }
      await queuePDFPages(new File([''], 'doc.pdf'), new ArrayBuffer(8), 'f-timeout')
      await vi.waitFor(() => {
        expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({
          status: 'error',
          logs: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('timed out') })])
        }))
      })
      expect(getQueueStats().pending).toBe(0)
    } finally {
      PAGE_RENDER_CONFIG.renderTimeoutMs = original
    }
  })

  it('a worker crash fails in-flight renders immediately', async () => {
    mockOpenReply = { numPages: 1 }
    await queuePDFPages(new File([''], 'doc.pdf'), new ArrayBuffer(8), 'f-crash')
    await settle()

    ;(lastWorkerInstance as any).trigger('error', { message: 'Out of memory' })

    await vi.waitFor(() => expect(getQueueStats().pending).toBe(0))
    expect(pdfEvents.emit).toHaveBeenCalledWith('pdf:page:error', expect.objectContaining({ error: 'Worker error: Out of memory' }))
  })

  it('resume re-opens the stored source in the worker (transfer) before re-queuing', async () => {
    const page = { id: 'p-res', fileId: 'f-res', status: 'pending_render', pageNumber: 1, origin: 'pdf_generated', order: 1, logs: [] }
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce([page as any]).mockResolvedValueOnce([])
    const stored = new ArrayBuffer(16)
    vi.mocked(db.getFile).mockResolvedValue({ name: 't.pdf', content: stored, size: 16 } as any)
    vi.mocked(db.getPage).mockResolvedValue(page as any)

    await resumePDFProcessing()
    await settle()

    expect(workerMessages[0]!.data).toEqual({ type: 'open', payload: { docId: 'f-res', pdfData: stored } })
    expect(workerMessages[0]!.transfer).toEqual([stored])
    expect(renderMessages()[0]!.data.payload.docId).toBe('f-res')
  })

  it('resume marks pages as error when the stored source cannot be opened', async () => {
    const page = { id: 'p-res-bad', fileId: 'f-res-bad', status: 'pending_render', pageNumber: 1, origin: 'pdf_generated', order: 1 }
    vi.mocked(db.getPagesByStatus).mockResolvedValueOnce([page as any]).mockResolvedValueOnce([])
    vi.mocked(db.getFile).mockResolvedValue({ name: 't.pdf', content: new ArrayBuffer(4), size: 4 } as any)
    mockOpenReply = { error: 'Corrupt' }

    await resumePDFProcessing()

    expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-res-bad', status: 'error' }))
    expect(renderMessages()).toHaveLength(0)
  })
})

describe('Coverage Gaps', () => {
  it('handleRenderSuccess: should catch internal errors', async () => {
    const { file, pdfData } = getTestData()
    vi.mocked(db.savePage).mockResolvedValue('p-crash')
    vi.mocked(db.savePagesBatch).mockResolvedValue(['p-crash'])
    // Force exception inside handleRenderSuccess by making db.getPage throw
    // 1. queuePDFPageRender
    // 2. renderPDFPage
    // 3. handleRenderSuccess (This one should fail)
    vi.mocked(db.getPage)
      .mockResolvedValueOnce({ id: 'p-crash', status: 'pending_render', logs: [] } as any)
      .mockResolvedValueOnce({ id: 'p-crash', status: 'rendering', logs: [] } as any)
      .mockRejectedValueOnce(new Error('Inner Crash'))

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({ data: { pageId: 'p-crash', imageBlob: new Blob() } })
    }
    mockOpenReply = { numPages: 1 }
    await queuePDFPages(file, pdfData, 'f-crash')
    await new Promise(res => setTimeout(res, 50))
    expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error handling render success'), expect.anything())
  })

  it('handleRenderError: should catch internal errors', async () => {
    const { file, pdfData } = getTestData()
    vi.mocked(db.savePage).mockResolvedValue('p-crash-err')
    vi.mocked(db.savePagesBatch).mockResolvedValue(['p-crash-err'])
    // Force exception inside handleRenderError
    // 1. queuePDFPageRender
    // 2. renderPDFPage
    // 3. handleRenderError (This one should fail)
    vi.mocked(db.getPage)
      .mockResolvedValueOnce({ id: 'p-crash-err', status: 'pending_render', logs: [] } as any)
      .mockResolvedValueOnce({ id: 'p-crash-err', status: 'rendering', logs: [] } as any)
      .mockRejectedValueOnce(new Error('Inner Error Crash'))

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({ data: { type: 'error', payload: { pageId: 'p-crash-err', error: 'Fail' } } })
    }
    mockOpenReply = { numPages: 1 }
    await queuePDFPages(file, pdfData, 'f-crash-err')
    await new Promise(res => setTimeout(res, 50))
    expect(queueLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error handling render error'), expect.anything())
  })


  it('coverage: force thumbnail generation success and cleanup', async () => {
    // Manual mocks to bypass JSDOM limitations and internal call issues
    const OriginalImage = globalThis.Image
    const originalCreateElement = document.createElement

    // Mock Image
    globalThis.Image = class MockSuccessImage {
      width = 100
      height = 100
      set src(_: string) {
        setTimeout(() => { if (this.onload) this.onload(new Event('load')) }, 0)
      }
      onload: ((this: any, ev: Event) => unknown) | null = null;
      onerror: ((this: any, ev: Event) => unknown) | null = null;
    } as unknown as typeof Image

    // Mock Document.createElement for Canvas
    document.createElement = vi.fn((tagName) => {
      if (tagName === 'canvas') {
        return {
          getContext: () => ({ drawImage: vi.fn() }),
          toDataURL: () => 'data:mock-thumb',
          width: 0,
          height: 0
        } as any
      }
      return originalCreateElement.call(document, tagName)
    }) as any

    const pdfQueueModule = await import('@/services/pdf/pdfQueue')
    // Populate source cache to avoid "source data not found" error
    pdfQueueModule.pdfSourceCache.set('src_mock', {
      totalPages: 1,
      processedCount: 0,
      fallbackFont: 'sans-serif'
    })

    vi.mocked(db.savePage).mockResolvedValue('p-thumb-success')
    vi.mocked(db.savePagesBatch).mockResolvedValue(['p-thumb-success'])
    vi.mocked(db.getPage).mockResolvedValue({ id: 'p-thumb-success', status: 'pending_render', logs: [] } as any)

    // Explicitly mock db.getAllPages
    const getAllPagesSpy = vi.fn().mockResolvedValue([])
    vi.mocked(db.getAllPages).mockImplementation(getAllPagesSpy)

    // Mock worker response
    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({
        data: {
          pageId: 'p-thumb-success',
          imageBlob: new Blob(['img']),
          width: 100,
          height: 100,
          pageNumber: 1,
          fileSize: 1000
        }
      })
    }

    // Run test with valid sourceId
    await queuePDFPageRender({
      pageId: 'p-thumb-success',
      pageNumber: 1,
      fileName: 'f.pdf',
      sourceId: 'src_mock'
    })

    await vi.waitFor(() => {
      // Verify intermediate step
      expect(db.savePage).toHaveBeenCalledWith(expect.objectContaining({
        status: 'ready',
        thumbnailData: 'data:mock-thumb'
      }))

      // Verify cleanup
      expect(getAllPagesSpy).toHaveBeenCalled()
      // Also verify cache cleanup if possible, but logging is enough
    }, { timeout: 2000 })

    // Restore
    globalThis.Image = OriginalImage
    document.createElement = originalCreateElement
  })

  it('coverage: handleRenderError with valid task', async () => {
    // Ensure line 196 (get task) is hit and proceeds
    vi.mocked(db.savePage).mockResolvedValue('p-err-cover')
    vi.mocked(db.getPage).mockResolvedValue({ id: 'p-err-cover', status: 'pending_render', logs: [] } as any)

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({
        data: {
          type: 'error',
          payload: { pageId: 'p-err-cover', error: 'Forced Error' }
        }
      })
    }

    await queuePDFPageRender({
      pageId: 'p-err-cover',
      pageNumber: 1,
      fileName: 'f.pdf',
      sourceId: 's1'
    })
    await new Promise(res => setTimeout(res, 50))
    expect(queueLogger.info).toHaveBeenCalledWith(expect.stringContaining('Render error for pageId'))
  })

  it('generateThumbnail: should handle canvas errors', async () => {
    vi.mocked(db.savePage).mockResolvedValue('p-canvas-fail')
    vi.mocked(db.savePagesBatch).mockResolvedValue(['p-canvas-fail'])
    vi.mocked(db.getPage).mockResolvedValue({ id: 'p-canvas-fail', status: 'pending_render', logs: [] } as any)

    // Manual mocks to bypass JSDOM limitations
    const OriginalImage = globalThis.Image
    const originalCreateElement = document.createElement

    // Mock Image
    globalThis.Image = class MockSuccessImage {
      width = 100
      height = 100
      set src(_: string) {
        setTimeout(() => { if (this.onload) this.onload(new Event('load')) }, 0)
      }
      onload: ((this: any, ev: Event) => unknown) | null = null;
      onerror: ((this: any, ev: Event) => unknown) | null = null;
    } as unknown as typeof Image

    // Mock Document.createElement for Canvas to throw error
    document.createElement = vi.fn((tagName) => {
      if (tagName === 'canvas') {
        throw new Error('Canvas Fail')
      }
      return originalCreateElement.call(document, tagName)
    }) as any

    const pdfQueueModule = await import('@/services/pdf/pdfQueue')
    pdfQueueModule.pdfSourceCache.set('src_mock_canvas', {
      totalPages: 1,
      processedCount: 0,
      fallbackFont: 'sans-serif'
    })

    mockWorkerResponseCallback = (worker, _) => {
      // @ts-expect-error: accessing private/protected property for testing
      worker.onmessage({
        data: {
          pageId: 'p-canvas-fail',
          imageBlob: new Blob(['img']),
          width: 100,
          height: 100,
          pageNumber: 1,
          fileSize: 1000
        }
      })
    }

    await queuePDFPageRender({
      pageId: 'p-canvas-fail',
      pageNumber: 1,
      fileName: 'f.pdf',
      sourceId: 'src_mock_canvas'
    })

    await new Promise(res => setTimeout(res, 200))

    expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to generate thumbnail'), expect.anything())

    globalThis.Image = OriginalImage
    document.createElement = originalCreateElement
  })

  // Add missing test for renderPDFPage early exit
  it('renderPDFPage: should exit if page deleted before render', async () => {
    // Mock queuePDFPageRender logic partially
    // We define a task and call renderPDFPage indirectly via queuePDFPageRender
    // But mock db.getPage to return undefined exactly when renderPDFPage runs

    // 1. queuePDFPageRender (success)
    // 2. renderPDFPage (missing)
    vi.mocked(db.getPage)
      .mockResolvedValueOnce({ id: 'p-del', status: 'pending_render' } as any)
      .mockResolvedValueOnce(undefined)

    await queuePDFPageRender({ pageId: 'p-del', pageNumber: 1, fileName: 'f.pdf', sourceId: 's1' })
    expect(queueLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no longer in database'))
  })
})

function setupDefaultDbMocks() {
  vi.mocked(db.getNextOrder).mockResolvedValue(1)
  vi.mocked(db.savePage).mockResolvedValue('page-id-1')
  vi.mocked(db.getPage).mockResolvedValue({ id: 'page-id-1', status: 'pending_render', logs: [] } as unknown as import("@/db").DBPage)
  vi.mocked(db.getAllPages).mockResolvedValue([])
  vi.mocked(db.getPagesByStatus).mockResolvedValue([])
  // @ts-expect-error: mock implementation mismatch
  vi.mocked(db.getFile).mockResolvedValue({ name: 't.pdf', content: new Blob([]), size: 100 } as import("@/db").DBPage)
}

function setupGlobalMocks() {
  globalThis.Worker = MockWorker as unknown as typeof Worker
  mockWorkerResponseCallback = undefined
  mockWorkerLastMessage = undefined
  workerMessages = []
  mockOpenReply = { numPages: 1 }

  // @ts-expect-error: mocking global URL
  globalThis.URL = class MockURL {
    constructor() { }
    static readonly createObjectURL = vi.fn().mockReturnValue('blob:url')
    static readonly revokeObjectURL = vi.fn()
  }

  // @ts-expect-error: mocking global Image
  globalThis.Image = class MockImage {
    onload: ((this: any, ev: ProgressEvent<FileReader>) => unknown) | null = null; src = ''; width = 100; height = 100
    constructor() { setTimeout(() => { if (this.src && this.onload) this.onload({} as any) }, 0) }
  }

  const originalCreateElement = document.createElement.bind(document)
  document.createElement = vi.fn((tag) => {
    if (tag === 'canvas') return { getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => 'data:img', width: 0, height: 0 } as unknown as HTMLCanvasElement
    return originalCreateElement(tag)
  })
}

function getTestData() {
  return { file: new File([''], 't.pdf', { type: 'application/pdf' }), pdfData: new ArrayBuffer(10) }
}