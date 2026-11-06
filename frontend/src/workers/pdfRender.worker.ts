import * as pdfjsLib from 'pdfjs-dist'
import {
  CMAP_URL,
  CMAP_PACKED,
  STANDARD_FONT_DATA_URL,
  PAGE_RENDER_CONFIG,
  computeRenderScale,
  imageMimeType,
  type PageImageFormat
} from '../services/pdf/config'
import { workerLogger } from '@/utils/logger'

// Configure worker
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Protocol (main thread <-> render worker)
 *
 *   open   { docId, pdfData }  -> opened { docId, numPages, sampleText } | open-error { docId, error }
 *          pdfData MUST be sent in the transfer list: the bytes cross the thread boundary once.
 *   render { docId, pageId, pageNumber, ... } -> started, then a PDFRenderResult | error
 *          Uses the cached PDFDocumentProxy; no PDF bytes travel per page.
 *   close  { docId }           -> closed { docId }  (destroys the cached document)
 */
export interface OpenMessage {
  type: 'open'
  payload: { docId: string; pdfData: ArrayBuffer }
}

export interface RenderMessage {
  type: 'render'
  payload: {
    docId: string
    pageId: string
    pageNumber: number
    /** Fixed scale; when omitted the scale is derived from targetLongEdgePx */
    scale?: number
    targetLongEdgePx?: number
    maxScale?: number
    imageFormat?: PageImageFormat
    quality?: number
    fallbackFontFamily?: string
  }
}

export interface CloseMessage {
  type: 'close'
  payload: { docId: string }
}

type WorkerMessage = OpenMessage | RenderMessage | CloseMessage

interface PDFRenderResult {
  pageId: string
  imageBlob: Blob // Directly return binary data
  width: number
  height: number
  pageNumber: number
  fileSize: number
}

/** Number of leading pages whose text is sampled for the main-thread fallback-font choice */
const FONT_SAMPLE_PAGES = 3

// docId -> loading/loaded document. Holding the promise lets renders queue behind an open.
const documents = new Map<string, Promise<pdfjsLib.PDFDocumentProxy>>()

// Polyfill global document for PDF.js internals that expect it even in workers
/* v8 ignore start */
if (typeof self !== 'undefined' && !self.document) {
  const mockElement = () => ({
    style: {},
    remove: () => { },
    appendChild: (child: unknown) => child,
    removeChild: (child: unknown) => child,
    setAttribute: () => { },
    getAttribute: () => null,
    textContent: '',
  });

  (self as unknown as { document: unknown }).document = {
    createElement: (tagName: string) => {
      if (tagName === 'canvas') {
        return new OffscreenCanvas(1, 1);
      }
      return mockElement();
    },
    documentElement: mockElement(),
    head: mockElement(),
    body: mockElement(),
    getElementsByTagName: () => [],
    createEvent: () => ({
      initEvent: () => { },
    }),
  };
}
/* v8 ignore stop */

// Custom CanvasFactory for Web Worker using OffscreenCanvas
interface CanvasAndContext {
  canvas: OffscreenCanvas | null
  context: OffscreenCanvasRenderingContext2D | null
}

class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    return {
      canvas,
      context: canvas.getContext('2d'),
    };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = Math.max(1, width);
      canvasAndContext.canvas.height = Math.max(1, height);
    }
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
    }
    canvasAndContext.context = null;
  }
}

// Worker implementation
self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  switch (message?.type) {
    case 'open':
      await handleOpen(message.payload)
      return
    case 'render':
      await handleRender(message.payload)
      return
    case 'close':
      await closeDocument(message.payload?.docId)
      self.postMessage({ type: 'closed', payload: { docId: message.payload?.docId } })
      return
    default:
      return
  }
})

async function handleOpen(payload: OpenMessage['payload']): Promise<void> {
  const docId = payload?.docId
  try {
    if (!docId) throw new Error('docId is required')
    if (!payload.pdfData || payload.pdfData.byteLength === 0) {
      throw new Error('pdfData is empty or invalid')
    }
    // Re-opening the same id replaces the previous document (e.g. resume after a reload)
    await closeDocument(docId)

    const loading = loadDocument(payload.pdfData)
    documents.set(docId, loading)
    let pdfDocument: pdfjsLib.PDFDocumentProxy
    try {
      pdfDocument = await loading
    } catch (error) {
      documents.delete(docId)
      throw error
    }

    const sampleText = await extractSampleText(pdfDocument)
    self.postMessage({ type: 'opened', payload: { docId, numPages: pdfDocument.numPages, sampleText } })
  } catch (error) {
    workerLogger.error('PDF open error:', error)
    self.postMessage({
      type: 'open-error',
      payload: { docId: docId || 'unknown', error: error instanceof Error ? error.message : 'Unknown open error' }
    })
  }
}

function loadDocument(pdfData: ArrayBuffer): Promise<pdfjsLib.PDFDocumentProxy> {
  // pdf.js takes ownership of the bytes (it may transfer them to its own parser thread)
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfData),
    cMapUrl: CMAP_URL,
    cMapPacked: CMAP_PACKED,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: true,
    disableFontFace: true,
    fontExtraProperties: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canvasFactory: new OffscreenCanvasFactory() as any,
    verbosity: 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  return loadingTask.promise
}

/**
 * Text of the first pages, used on the main thread to pick a fallback font (needs `document`
 * for font detection, so only the text crosses back). Failures only degrade the font choice.
 */
async function extractSampleText(pdfDocument: pdfjsLib.PDFDocumentProxy): Promise<string> {
  let text = ''
  const pages = Math.min(pdfDocument.numPages, FONT_SAMPLE_PAGES)
  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    try {
      const page = await pdfDocument.getPage(pageNumber)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if ('str' in item && item.str) text += item.str + ' '
      }
      page.cleanup()
    } catch (error) {
      workerLogger.warn(`Font sample: failed to read text of page ${pageNumber}:`, error)
    }
  }
  return text
}

async function closeDocument(docId: string | undefined): Promise<void> {
  if (!docId) return
  const loading = documents.get(docId)
  if (!loading) return
  documents.delete(docId)
  try {
    const pdfDocument = await loading
    await pdfDocument.destroy()
  } catch (error) {
    // Either the open already failed (reported via open-error) or destroy failed; nothing to free
    workerLogger.warn(`Closing document ${docId} failed:`, error)
  }
}

async function handleRender(payload: RenderMessage['payload']): Promise<void> {
  try {
    const result = await renderPage(payload)
    self.postMessage(result)
  } catch (error) {
    workerLogger.error('PDF rendering error:', error)
    self.postMessage({
      type: 'error',
      payload: {
        pageId: payload?.pageId || 'unknown',
        error: error instanceof Error ? error.message : 'Unknown rendering error'
      }
    })
  }
}

/**
 * Main rendering logic for a single PDF page
 */
async function renderPage(payload: RenderMessage['payload']): Promise<PDFRenderResult> {
  const {
    docId,
    pageId,
    pageNumber,
    imageFormat = PAGE_RENDER_CONFIG.imageFormat,
    quality = PAGE_RENDER_CONFIG.quality,
    fallbackFontFamily
  } = payload

  validateRenderInputs(payload)

  const loading = documents.get(docId)
  if (!loading) {
    throw new Error(`Document ${docId} is not open in the render worker`)
  }

  // Notify main thread that rendering is starting
  self.postMessage({
    type: 'started',
    payload: {
      pageId,
      pageNumber
    }
  })

  const pdfDocument = await loading
  const page = await pdfDocument.getPage(pageNumber)
  try {
    const scale = payload.scale ?? resolveScale(page, payload)
    const viewport = page.getViewport({ scale })

    // Create and configure canvas
    const canvas = new OffscreenCanvas(viewport.width, viewport.height)
    const context = configureRenderContext(canvas, scale, fallbackFontFamily)

    const renderContext = createRenderContext(context, viewport)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (page.render(renderContext as any).promise)
    } catch (renderError) {
      workerLogger.warn('Enhanced rendering failed, falling back to standard rendering:', renderError)
      await (page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport: viewport,
        intent: 'print',

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        canvasFactory: new OffscreenCanvasFactory() as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).promise)
    }

    const blob = await canvas.convertToBlob({
      type: imageMimeType(imageFormat),
      quality: imageFormat === 'jpeg' ? quality : undefined
    })

    // Free the backing store now rather than at GC time (matters for long documents)
    canvas.width = 0
    canvas.height = 0

    return {
      pageId,
      imageBlob: blob,
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      fileSize: blob.size
    }
  } finally {
    try {
      page.cleanup()
    } catch (e) {
      workerLogger.warn('Page cleanup failed:', e)
    }
  }
}

function resolveScale(page: pdfjsLib.PDFPageProxy, payload: RenderMessage['payload']): number {
  const base = page.getViewport({ scale: 1 })
  return computeRenderScale(
    base.width,
    base.height,
    payload.targetLongEdgePx ?? PAGE_RENDER_CONFIG.targetLongEdgePx,
    payload.maxScale ?? PAGE_RENDER_CONFIG.maxScale
  )
}

function validateRenderInputs(payload: RenderMessage['payload']): void {
  if (!payload.pageId) throw new Error('pageId is required')
  if (!payload.pageNumber || payload.pageNumber < 1) {
    throw new Error(`Invalid pageNumber: ${payload.pageNumber}`)
  }
  if (!payload.docId) throw new Error('docId is required')
}

function configureRenderContext(canvas: OffscreenCanvas, scale: number, fallbackFontFamily?: string) {
  const context = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
    willReadFrequently: false
  }) as unknown as OffscreenCanvasRenderingContext2D

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  if (fallbackFontFamily) {
    context.font = `${16 * scale}px ${fallbackFontFamily}`
  }
  return context
}

function createRenderContext(
  context: OffscreenCanvasRenderingContext2D,
  viewport: pdfjsLib.PageViewport
) {
  return {
    canvasContext: context,
    viewport: viewport,
    intent: 'print' as const,
    renderInteractiveForms: true,
    canvasFactory: new OffscreenCanvasFactory()
  }
}
