/**
 * End-to-end (unit-level) harness for the PDF pipeline: real add service -> real PDF service ->
 * real queue -> real render worker module, wired through a fake Worker that applies
 * structured-clone semantics (honouring the transfer list) so copies can be counted exactly.
 *
 * pdf.js itself is mocked: we only count how many times a document is parsed (getDocument)
 * and how many bytes are handed to it. Image bytes are measured in a real browser by
 * tests/e2e/specs/pdf-pipeline-metrics.spec.ts.
 *
 * The metrics are printed (grep "[pdf-pipeline-metrics]") and asserted as regression gates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const BIG = 64 * 1024

// --- pdf.js mock: counts document parses --------------------------------------------------
const pdfjsState = vi.hoisted(() => ({
  numPages: 1,
  getDocumentCalls: 0,
  bytesParsed: 0,
  destroyed: 0
}))

vi.mock('pdfjs-dist', () => {
  const makePage = () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    getTextContent: async () => ({ items: [{ str: 'Sample text' }] }),
    cleanup: () => { }
  })
  return {
    version: '5.0.0',
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: (params: { data: Uint8Array }) => {
      pdfjsState.getDocumentCalls++
      pdfjsState.bytesParsed += params.data.byteLength
      const doc = {
        numPages: pdfjsState.numPages,
        getPage: async () => makePage(),
        getMetadata: async () => ({ info: {} }),
        destroy: async () => { pdfjsState.destroyed++ }
      }
      return { promise: Promise.resolve(doc), destroy: async () => { } }
    }
  }
})
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.min.mjs' }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({ default: 'pdf.worker.mjs' }))

// --- app-level mocks ------------------------------------------------------------------------
const dbState = vi.hoisted(() => ({ pages: new Map<string, Record<string, unknown>>(), images: 0, imageBytes: 0 }))

vi.mock('@/db/index', () => {
  let idCounter = 0
  return {
    generatePageId: () => `page-${++idCounter}`,
    db: {
      saveFile: vi.fn(async () => 'file-1'),
      getFile: vi.fn(async () => undefined),
      deleteFile: vi.fn(async () => { }),
      savePagesBatch: vi.fn(async (pages: Record<string, unknown>[]) => {
        pages.forEach(p => dbState.pages.set(p.id as string, { ...p }))
        return pages.map(p => p.id as string)
      }),
      getPage: vi.fn(async (id: string) => dbState.pages.get(id)),
      savePage: vi.fn(async (p: Record<string, unknown>) => { dbState.pages.set(p.id as string, { ...p }) }),
      savePageImage: vi.fn(async (_id: string, blob: Blob) => { dbState.images++; dbState.imageBytes += blob.size }),
      getAllPages: vi.fn(async () => [...dbState.pages.values()]),
      getPagesByStatus: vi.fn(async () => [])
    }
  }
})

vi.mock('@/services/font/fontLoader', () => ({
  fontLoader: {
    preloadCommonFonts: vi.fn(async () => { }),
    getBestFont: vi.fn(() => 'sans-serif')
  }
}))

vi.mock('@/utils/logger', () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { pdfLogger: l, queueLogger: l, workerLogger: l, addLogger: l }
})

// --- fake Worker: structured clone with transfer semantics ----------------------------------
const channel = vi.hoisted(() => ({
  clonedPdfBytes: 0,
  transferredPdfBytes: 0,
  messagesWithPdfBytes: 0,
  messages: 0
}))

type Listener = (ev: { data: unknown }) => void

function pdfBytesOf(msg: unknown): ArrayBuffer | undefined {
  const data = (msg as { payload?: { pdfData?: unknown } } | null)?.payload?.pdfData
  return data instanceof ArrayBuffer ? data : undefined
}

class FakeWorker {
  private mainListeners: Listener[] = []
  private workerListeners: Listener[] = []
  private ready: Promise<void>

  constructor() {
    // Load the real worker module with `self` bound to this fake worker scope
    const g = globalThis as unknown as Record<string, unknown>
    const prevAdd = g.addEventListener
    g.addEventListener = (type: string, fn: Listener) => { if (type === 'message') this.workerListeners.push(fn) }
    g.postMessage = (data: unknown) => {
      setTimeout(() => this.mainListeners.forEach(l => l({ data })), 0)
    }
    // g.postMessage keeps pointing at this worker: the worker module calls self.postMessage lazily
    this.ready = import('@/workers/pdfRender.worker').then(() => {
      g.addEventListener = prevAdd
    })
  }

  addEventListener(type: string, fn: Listener) {
    if (type === 'message') this.mainListeners.push(fn)
  }

  postMessage(msg: unknown, opts?: { transfer?: unknown[] } | unknown[]) {
    const transfer = Array.isArray(opts) ? opts : (opts?.transfer ?? [])
    const pdf = pdfBytesOf(msg)
    channel.messages++
    if (pdf) {
      channel.messagesWithPdfBytes++
      if (transfer.includes(pdf)) channel.transferredPdfBytes += pdf.byteLength
      else channel.clonedPdfBytes += pdf.byteLength
    }
    const delivered = structuredClone(msg, { transfer } as Parameters<typeof structuredClone>[1])
    this.ready.then(() => this.workerListeners.forEach(l => l({ data: delivered })))
  }

  terminate() { }
}

class MockOffscreenCanvas {
  width: number
  height: number
  constructor(width: number, height: number) { this.width = width; this.height = height }
  getContext() { return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low' } }
  async convertToBlob({ type }: { type: string }) { return new Blob(['x'.repeat(16)], { type }) }
}

// --- main-thread copy counters --------------------------------------------------------------
const copies = { slices: 0, sliceBytes: 0, dataUrlBytes: 0, atobChars: 0, blobReads: 0, blobReadBytes: 0 }

function installCopyCounters() {
  const origSlice = ArrayBuffer.prototype.slice
  vi.spyOn(ArrayBuffer.prototype, 'slice').mockImplementation(function (this: ArrayBuffer, ...a: [number?, number?]) {
    const out = origSlice.apply(this, a)
    if (out.byteLength >= BIG) { copies.slices++; copies.sliceBytes += out.byteLength }
    return out
  })
  const origDataUrl = FileReader.prototype.readAsDataURL
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader, b: Blob) {
    if (b.size >= BIG) copies.dataUrlBytes += b.size
    return origDataUrl.call(this, b)
  })
  const origAtob = globalThis.atob
  vi.spyOn(globalThis, 'atob').mockImplementation((s: string) => {
    if (s.length >= BIG) copies.atobChars += s.length
    return origAtob(s)
  })
  // jsdom's Blob has no arrayBuffer(); browsers do. Polyfill via FileReader and count reads.
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    value: function (this: Blob): Promise<ArrayBuffer> {
      if (this.size >= BIG) { copies.blobReads++; copies.blobReadBytes += this.size }
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  })
}

async function runPipeline(bytes: Uint8Array, pages: number) {
  pdfjsState.numPages = pages
  const file = new File([bytes.buffer as ArrayBuffer], 'doc.pdf', { type: 'application/pdf' })
  const { fileAddService } = await import('@/services/add/index')
  installCopyCounters()
  const result = await fileAddService.processFiles([file])
  expect(result.error).toBeUndefined()
  await vi.waitFor(() => { expect(dbState.images).toBe(pages) }, { timeout: 20_000, interval: 20 })
  // let the final "close" round-trip settle
  await new Promise(r => setTimeout(r, 20))
  return {
    pages,
    fileBytes: bytes.byteLength,
    mainThreadSliceCopies: copies.slices,
    mainThreadSliceBytes: copies.sliceBytes,
    base64DataUrlBytes: copies.dataUrlBytes,
    atobChars: copies.atobChars,
    fileReads: copies.blobReads,
    fileReadBytes: copies.blobReadBytes,
    workerMessagesWithPdfBytes: channel.messagesWithPdfBytes,
    pdfBytesClonedToWorker: channel.clonedPdfBytes,
    pdfBytesTransferredToWorker: channel.transferredPdfBytes,
    getDocumentCalls: pdfjsState.getDocumentCalls,
    bytesParsedByPdfjs: pdfjsState.bytesParsed,
    documentsDestroyed: pdfjsState.destroyed
  }
}

describe('PDF pipeline metrics', () => {
  const originalWorker = globalThis.Worker
  const originalImage = globalThis.Image

  beforeEach(() => {
    vi.resetModules()
    Object.assign(pdfjsState, { getDocumentCalls: 0, bytesParsed: 0, destroyed: 0 })
    Object.assign(channel, { clonedPdfBytes: 0, transferredPdfBytes: 0, messagesWithPdfBytes: 0, messages: 0 })
    Object.assign(copies, { slices: 0, sliceBytes: 0, dataUrlBytes: 0, atobChars: 0, blobReads: 0, blobReadBytes: 0 })
    dbState.pages.clear(); dbState.images = 0; dbState.imageBytes = 0
    globalThis.Worker = FakeWorker as unknown as typeof Worker
    ;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = MockOffscreenCanvas
    // Thumbnails need a real image decoder; fail fast instead (the queue tolerates this)
    globalThis.Image = class {
      onerror: (() => void) | null = null
      set src(_v: string) { setTimeout(() => this.onerror?.(), 0) }
    } as unknown as typeof Image
  })

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.Worker = originalWorker
    globalThis.Image = originalImage
  })

  it('sample3.pdf (8.5 MB, 32 pages): one parse, one transfer, no per-page copies', async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../../tests/e2e/samples/sample3.pdf'))
    const m = await runPipeline(new Uint8Array(bytes), 32)
    process.stdout.write(`[pdf-pipeline-metrics] sample3 ${JSON.stringify(m)}\n`)

    expect(m.getDocumentCalls).toBe(1)
    expect(m.pdfBytesClonedToWorker).toBe(0)
    expect(m.pdfBytesTransferredToWorker).toBe(m.fileBytes)
    expect(m.workerMessagesWithPdfBytes).toBe(1)
    expect(m.mainThreadSliceBytes).toBe(0)
    expect(m.base64DataUrlBytes).toBe(0)
    expect(m.documentsDestroyed).toBe(1)
  })

  it('200-page PDF: parse count does not grow with page count', async () => {
    const bytes = new Uint8Array(2_446_376) // same size as the generated 200-page E2E fixture
    const m = await runPipeline(bytes, 200)
    process.stdout.write(`[pdf-pipeline-metrics] generated-200 ${JSON.stringify(m)}\n`)

    expect(m.getDocumentCalls).toBe(1)
    expect(m.pdfBytesClonedToWorker).toBe(0)
    expect(m.workerMessagesWithPdfBytes).toBe(1)
    expect(m.mainThreadSliceBytes).toBe(0)
    expect(m.documentsDestroyed).toBe(1)
  })
})
