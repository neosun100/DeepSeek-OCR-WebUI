import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Mock 'pdfjs-dist' and its worker URL BEFORE importing the worker
vi.mock('pdfjs-dist', () => ({
  version: '4.0.0',
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mock-worker-url' }));

// Keep the real render settings/scale helpers, only pin the asset URLs
vi.mock('@/services/pdf/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/pdf/config')>()),
  CMAP_URL: '/cmaps/',
  CMAP_PACKED: true,
  STANDARD_FONT_DATA_URL: '/standard_fonts/',
}));

vi.mock('@/utils/logger', () => ({
  workerLogger: { warn: vi.fn(), error: vi.fn() },
}));

// 2. Worker global scope mocks
let messageHandler: ((event: MessageEvent) => Promise<void>) | null = null;
const postMessageMock = vi.fn();
const addEventListenerMock = vi.fn((type, handler) => {
  if (type === 'message') messageHandler = handler;
});
(globalThis as any).self = globalThis;
(globalThis as any).addEventListener = addEventListenerMock;
(globalThis as any).postMessage = postMessageMock;

const convertToBlobMock = vi.fn(({ type }: { type: string }) => Promise.resolve(new Blob(['mock-image-data'], { type })));
class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
  }
  convertToBlob(opts: { type: string; quality?: number }) {
    return convertToBlobMock(opts);
  }
}
(globalThis as any).OffscreenCanvas = MockOffscreenCanvas;

/** A4 page: 595 x 842 pt at scale 1 */
function makePage(overrides: Record<string, unknown> = {}) {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale })),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    getTextContent: vi.fn().mockResolvedValue({ items: [{ str: 'Hello' }, { str: '世界' }, { type: 'beginMarkedContent' }] }),
    cleanup: vi.fn(),
    ...overrides,
  };
}

function makeDocument(page = makePage(), numPages = 5) {
  return {
    numPages,
    getPage: vi.fn().mockResolvedValue(page),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe('pdfRender.worker', () => {
  let pdfjsLib: typeof import('pdfjs-dist');
  let getDocument: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    messageHandler = null;
    vi.resetModules();
    pdfjsLib = await import('pdfjs-dist');
    getDocument = pdfjsLib.getDocument as unknown as ReturnType<typeof vi.fn>;

    (globalThis as any).addEventListener = addEventListenerMock;
    (globalThis as any).postMessage = postMessageMock;
    (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;

    await import('@/workers/pdfRender.worker');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const send = async (data: unknown) => {
    if (!messageHandler) throw new Error('Message handler not registered');
    await messageHandler({ data } as MessageEvent);
  };
  const open = (docId = 'doc-1', bytes = 100) => send({ type: 'open', payload: { docId, pdfData: new ArrayBuffer(bytes) } });
  const render = (payload: Record<string, unknown> = {}) =>
    send({ type: 'render', payload: { docId: 'doc-1', pageId: 'p1', pageNumber: 1, ...payload } });
  const lastErrorFor = (pageId: string) =>
    postMessageMock.mock.calls.map(c => c[0]).find(m => m?.type === 'error' && m.payload.pageId === pageId);

  it('should register a message listener', () => {
    expect(addEventListenerMock).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should ignore unknown messages', async () => {
    await send({ type: 'ping' });
    await send(null);
    expect(getDocument).not.toHaveBeenCalled();
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  describe('open', () => {
    it('parses the document once and reports page count + text sample', async () => {
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(makePage(), 7)) });

      await open('doc-1');

      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
        cMapUrl: '/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/standard_fonts/',
        useSystemFonts: true,
      }));
      expect(postMessageMock).toHaveBeenCalledWith({
        type: 'opened',
        payload: { docId: 'doc-1', numPages: 7, sampleText: 'Hello 世界 Hello 世界 Hello 世界 ' }
      });
    });

    it('rejects empty data without touching pdf.js', async () => {
      await open('doc-1', 0);
      expect(getDocument).not.toHaveBeenCalled();
      expect(postMessageMock).toHaveBeenCalledWith({
        type: 'open-error',
        payload: { docId: 'doc-1', error: 'pdfData is empty or invalid' }
      });
    });

    it('rejects a missing docId', async () => {
      await send({ type: 'open', payload: { pdfData: new ArrayBuffer(10) } });
      expect(postMessageMock).toHaveBeenCalledWith({
        type: 'open-error',
        payload: { docId: 'unknown', error: 'docId is required' }
      });
    });

    it('reports parse failures and does not cache the failed document', async () => {
      getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF structure')) });
      await open('doc-1');
      expect(postMessageMock).toHaveBeenCalledWith({
        type: 'open-error',
        payload: { docId: 'doc-1', error: 'Invalid PDF structure' }
      });

      await render();
      expect(lastErrorFor('p1').payload.error).toContain('is not open');
    });

    it('reports non-Error throws with a generic message', async () => {
      getDocument.mockImplementation(() => { throw 'String error'; });
      await open('doc-1');
      expect(postMessageMock).toHaveBeenCalledWith({
        type: 'open-error',
        payload: { docId: 'doc-1', error: 'Unknown open error' }
      });
    });

    it('still opens when the text sample cannot be read (font choice degrades only)', async () => {
      const page = makePage({ getTextContent: vi.fn().mockRejectedValue(new Error('no text')) });
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(page, 1)) });
      await open('doc-1');
      expect(postMessageMock).toHaveBeenCalledWith({
        type: 'opened', payload: { docId: 'doc-1', numPages: 1, sampleText: '' }
      });
      const { workerLogger } = await import('@/utils/logger');
      expect(workerLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Font sample'), expect.any(Error));
    });

    it('re-opening the same docId destroys the previous document', async () => {
      const first = makeDocument();
      const second = makeDocument();
      getDocument
        .mockReturnValueOnce({ promise: Promise.resolve(first) })
        .mockReturnValueOnce({ promise: Promise.resolve(second) });

      await open('doc-1');
      await open('doc-1');

      expect(first.destroy).toHaveBeenCalledTimes(1);
      expect(second.destroy).not.toHaveBeenCalled();
    });
  });

  describe('render (cached document)', () => {
    it('cache hit: many pages, one getDocument, document not destroyed between pages', async () => {
      const doc = makeDocument();
      getDocument.mockReturnValue({ promise: Promise.resolve(doc) });
      await open('doc-1');

      for (let n = 1; n <= 5; n++) {
        await render({ pageId: `p${n}`, pageNumber: n });
      }

      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(doc.getPage).toHaveBeenCalledWith(5);
      expect(doc.destroy).not.toHaveBeenCalled();
      const results = postMessageMock.mock.calls.map(c => c[0]).filter(m => m.imageBlob);
      expect(results.map(r => r.pageId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    });

    it('sends started, then the image result sized to the target long edge (JPEG by default)', async () => {
      const page = makePage();
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(page)) });
      await open('doc-1');
      postMessageMock.mockClear();

      await render({ pageId: 'page-123' });

      expect(postMessageMock).toHaveBeenNthCalledWith(1, { type: 'started', payload: { pageId: 'page-123', pageNumber: 1 } });
      const scale = 2304 / 842;
      expect(page.getViewport).toHaveBeenLastCalledWith({ scale });
      expect(postMessageMock).toHaveBeenNthCalledWith(2, {
        pageId: 'page-123',
        imageBlob: expect.any(Blob),
        pageNumber: 1,
        width: 595 * scale,
        height: 2304,
        fileSize: expect.any(Number)
      });
      expect(convertToBlobMock).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.92 });
      expect(page.render).toHaveBeenCalled();
      expect(page.cleanup).toHaveBeenCalled();
    });

    it('honours an explicit scale and PNG format', async () => {
      const page = makePage();
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(page)) });
      await open('doc-1');

      await render({ scale: 2.0, imageFormat: 'png' });

      expect(page.getViewport).toHaveBeenCalledWith({ scale: 2.0 });
      expect(convertToBlobMock).toHaveBeenCalledWith({ type: 'image/png', quality: undefined });
    });

    it('caps the scale for tiny pages', async () => {
      const page = makePage({ getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 100 * scale })) });
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(page)) });
      await open('doc-1');

      await render({ maxScale: 4 });

      expect(page.getViewport).toHaveBeenLastCalledWith({ scale: 4 });
    });

    it('fails a render for a document that was never opened', async () => {
      await render({ docId: 'nope' });
      expect(getDocument).not.toHaveBeenCalled();
      expect(lastErrorFor('p1').payload.error).toBe('Document nope is not open in the render worker');
    });

    it.each([
      [{ pageId: undefined }, 'unknown', 'pageId is required'],
      [{ pageNumber: 0 }, 'p1', 'Invalid pageNumber: 0'],
      [{ docId: undefined }, 'p1', 'docId is required'],
    ])('validates inputs %#', async (override, pageId, error) => {
      await render(override);
      expect(lastErrorFor(pageId).payload.error).toBe(error);
    });

    it('falls back to standard rendering if the enhanced render fails', async () => {
      const page = makePage({
        render: vi.fn()
          .mockReturnValueOnce({ promise: Promise.reject(new Error('Enhanced render failed')) })
          .mockReturnValueOnce({ promise: Promise.resolve() }),
      });
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(page)) });
      await open('doc-1');

      await render({ fallbackFontFamily: 'Arial' });

      expect(page.render).toHaveBeenCalledTimes(2);
      const { workerLogger } = await import('@/utils/logger');
      expect(workerLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Enhanced rendering failed'), expect.any(Error));
      expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ pageId: 'p1', imageBlob: expect.any(Blob) }));
    });

    it('reports page errors and still cleans the page up', async () => {
      const page = makePage({ render: vi.fn().mockReturnValue({ promise: Promise.reject(new Error('Critical PDF Error')) }) });
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(page)) });
      await open('doc-1');

      await render();

      expect(lastErrorFor('p1').payload.error).toBe('Critical PDF Error');
      expect(page.cleanup).toHaveBeenCalled();
      const { workerLogger } = await import('@/utils/logger');
      expect(workerLogger.error).toHaveBeenCalledWith('PDF rendering error:', expect.any(Error));
    });

    it('logs (does not fail) when page cleanup throws', async () => {
      const page = makePage({ cleanup: vi.fn().mockImplementation(() => { throw new Error('Cleanup error'); }) });
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument(page, 1)) });
      await open('doc-1');

      await render();

      expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ pageId: 'p1', imageBlob: expect.any(Blob) }));
      const { workerLogger } = await import('@/utils/logger');
      expect(workerLogger.warn).toHaveBeenCalledWith('Page cleanup failed:', expect.any(Error));
    });

    it('provides a working OffscreenCanvasFactory to pdf.js', async () => {
      getDocument.mockReturnValue({ promise: Promise.resolve(makeDocument()) });
      await open('doc-1');

      const factory = getDocument.mock.calls[0]![0].canvasFactory;
      const obj = factory.create(100, 50);
      expect(obj.canvas).toBeInstanceOf(MockOffscreenCanvas);
      expect([obj.canvas.width, obj.canvas.height]).toEqual([100, 50]);
      factory.reset(obj, 200, 150);
      expect([obj.canvas.width, obj.canvas.height]).toEqual([200, 150]);
      factory.destroy(obj);
      expect(obj.canvas).toBeNull();
      expect(obj.context).toBeNull();

      const emptyObj = { canvas: null, context: null };
      factory.reset(emptyObj, 100, 100);
      factory.destroy(emptyObj);
    });
  });

  describe('close', () => {
    it('destroys the cached document and acknowledges; later renders fail', async () => {
      const doc = makeDocument();
      getDocument.mockReturnValue({ promise: Promise.resolve(doc) });
      await open('doc-1');

      await send({ type: 'close', payload: { docId: 'doc-1' } });

      expect(doc.destroy).toHaveBeenCalledTimes(1);
      expect(postMessageMock).toHaveBeenCalledWith({ type: 'closed', payload: { docId: 'doc-1' } });
      await render();
      expect(lastErrorFor('p1').payload.error).toContain('is not open');
    });

    it('is a no-op for unknown documents and tolerates destroy failures', async () => {
      await send({ type: 'close', payload: { docId: 'missing' } });
      expect(postMessageMock).toHaveBeenCalledWith({ type: 'closed', payload: { docId: 'missing' } });

      const doc = makeDocument();
      doc.destroy.mockRejectedValue(new Error('Destroy error'));
      getDocument.mockReturnValue({ promise: Promise.resolve(doc) });
      await open('doc-2');
      await send({ type: 'close', payload: { docId: 'doc-2' } });

      const { workerLogger } = await import('@/utils/logger');
      expect(workerLogger.warn).toHaveBeenCalledWith('Closing document doc-2 failed:', expect.any(Error));
    });
  });
});
