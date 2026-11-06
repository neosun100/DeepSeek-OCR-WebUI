/**
 * PDF pipeline metrics (opt-in measurement, not a regression gate).
 *
 * Run:  PDF_METRICS=1 npx playwright test pdf-pipeline-metrics --project=chromium --reporter=line
 *
 * It instruments the main thread before the app loads and reports, per PDF:
 *  - large ArrayBuffer copies on the main thread (ArrayBuffer.prototype.slice, Blob.arrayBuffer,
 *    FileReader.readAsDataURL, atob) - count and bytes
 *  - messages posted to the render worker carrying PDF bytes, and how many of those bytes were
 *    transferred (zero-copy) vs structured-cloned (copied)
 *  - pdf.js documents opened on the main thread (each getDocument() spawns one pdf.worker)
 *  - stored page image bytes / MIME type / pixel size read back from IndexedDB
 *
 * Skipped unless PDF_METRICS=1 so the normal E2E suite is unaffected.
 */
import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import fs from 'node:fs/promises'
import path from 'node:path'

const ENABLED = process.env.PDF_METRICS === '1'
const LARGE_PAGE_COUNT = Number(process.env.PDF_METRICS_PAGES || 200)

interface PostRecord { bytes: number; transferred: number; type: string }
interface F3Metrics {
  slices: number[]
  blobReads: number[]
  dataUrlReads: number[]
  atobChars: number[]
  renderPosts: PostRecord[]
  pdfjsWorkersMain: number
}

test.skip(!ENABLED, 'Set PDF_METRICS=1 to run the PDF pipeline measurement')
test.describe.configure({ mode: 'serial' })

/** Build an N-page "scanned book" PDF: every page draws the same embedded photo + a page label. */
async function buildLargePdf(outPath: string, pages: number): Promise<void> {
  const doc = await PDFDocument.create()
  const jpg = await doc.embedJpg(await fs.readFile(path.resolve('tests/e2e/samples/sample1.jpg')))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]) // A4 in points
    page.drawImage(jpg, { x: 20, y: 60, width: 555, height: 762 })
    page.drawText(`Page ${i} of ${pages}`, { x: 40, y: 30, size: 14, font })
  }
  await fs.writeFile(outPath, await doc.save())
}

/** Instrument main-thread copy paths. Must run before any app script. */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const BIG = 64 * 1024
    const m = {
      slices: [] as number[],
      blobReads: [] as number[],
      dataUrlReads: [] as number[],
      atobChars: [] as number[],
      renderPosts: [] as { bytes: number; transferred: number; type: string }[],
      pdfjsWorkersMain: 0
    }
    ;(window as unknown as { __f3: typeof m }).__f3 = m

    const origSlice = ArrayBuffer.prototype.slice
    ArrayBuffer.prototype.slice = function (this: ArrayBuffer, ...args: [number?, number?]) {
      const out = origSlice.apply(this, args)
      if (out.byteLength >= BIG) m.slices.push(out.byteLength)
      return out
    }

    const origBlobAB = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function (this: Blob) {
      if (this.size >= BIG) m.blobReads.push(this.size)
      return origBlobAB.call(this)
    }

    const origDataUrl = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (this: FileReader, blob: Blob) {
      if (blob.size >= BIG) m.dataUrlReads.push(blob.size)
      return origDataUrl.call(this, blob)
    }

    const origAtob = window.atob
    window.atob = (s: string) => {
      if (s.length >= BIG) m.atobChars.push(s.length)
      return origAtob(s)
    }

    const OrigWorker = window.Worker
    class TrackedWorker extends OrigWorker {
      readonly f3Url: string
      constructor(url: string | URL, opts?: ConstructorParameters<typeof Worker>[1]) {
        super(url, opts)
        this.f3Url = String(url)
        if (this.f3Url.includes('pdf.worker')) m.pdfjsWorkersMain++
      }
    }
    window.Worker = TrackedWorker as unknown as typeof Worker

    // How many PDF bytes a message carries and how many of them are in the transfer list
    const describePost = (msg: unknown, opt: unknown) => {
      const transfer: unknown[] = Array.isArray(opt)
        ? opt
        : ((opt as { transfer?: unknown[] } | undefined)?.transfer ?? [])
      const data = (msg as { payload?: { pdfData?: unknown } } | null)?.payload?.pdfData
      const bytes = data instanceof ArrayBuffer ? data.byteLength : 0
      const transferred = transfer.includes(data) ? bytes : 0
      return { bytes, transferred, type: String((msg as { type?: string } | null)?.type) }
    }

    const origPost = OrigWorker.prototype.postMessage
    OrigWorker.prototype.postMessage = function (this: Worker, msg: unknown, opt?: unknown) {
      if ((this as unknown as { f3Url?: string }).f3Url?.includes('pdfRender')) {
        m.renderPosts.push(describePost(msg, opt))
      }
      return origPost.call(this, msg, opt as Parameters<Worker['postMessage']>[1])
    }
  })
}

async function waitAllReady(page: Page, expected: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction((n) => {
    const store = (window as unknown as { pagesStore?: { pages: { status: string }[] } }).pagesStore
    if (!store) return false
    const pages = store.pages
    return pages.length === n && pages.every(p => p.status === 'ready' || p.status === 'error')
  }, expected, { timeout: timeoutMs, polling: 500 })
}

async function readStoredImages(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('Scan2Doc')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = db.transaction(['pageImages', 'pages'], 'readonly')
    const imagesReq = tx.objectStore('pageImages').getAll()
    const pagesReq = tx.objectStore('pages').getAll()
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    const images = imagesReq.result as { blob: Blob | ArrayBuffer }[]
    const pages = pagesReq.result as { status: string; width?: number; height?: number }[]
    db.close()
    const sizes = images.map(r => (r.blob instanceof Blob ? r.blob.size : r.blob.byteLength))
    const types = [...new Set(images.map(r => (r.blob instanceof Blob ? r.blob.type : 'arraybuffer')))]
    const first = pages.find(p => p.width)
    return {
      count: images.length,
      totalBytes: sizes.reduce((a, b) => a + b, 0),
      types,
      errorPages: pages.filter(p => p.status === 'error').length,
      firstPagePx: first ? `${Math.round(first.width!)}x${Math.round(first.height!)}` : 'n/a'
    }
  })
}

function sum(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) }

async function measure(page: Page, filePath: string, expectedPages: number, timeoutMs: number) {
  await instrument(page)
  await page.goto('/')
  await page.waitForFunction(() => !!(window as unknown as { pagesStore?: unknown }).pagesStore)

  const started = Date.now()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.app-header button:has-text("Import Files")')
  ])
  await chooser.setFiles(filePath)
  await waitAllReady(page, expectedPages, timeoutMs)
  const elapsedMs = Date.now() - started

  const m = await page.evaluate(() => (window as unknown as { __f3: F3Metrics }).__f3)
  const stored = await readStoredImages(page)
  const fileBytes = (await fs.stat(filePath)).size
  const pdfPosts = m.renderPosts.filter(p => p.bytes > 0)

  return {
    file: path.basename(filePath),
    fileBytes,
    pages: expectedPages,
    elapsedMs,
    mainThread: {
      sliceCopies: m.slices.length,
      sliceBytes: sum(m.slices),
      blobArrayBufferReads: m.blobReads.length,
      blobArrayBufferBytes: sum(m.blobReads),
      dataUrlReads: m.dataUrlReads.length,
      dataUrlBytes: sum(m.dataUrlReads),
      atobCalls: m.atobChars.length,
      atobChars: sum(m.atobChars)
    },
    renderWorker: {
      messages: m.renderPosts.length,
      messagesWithPdfBytes: pdfPosts.length,
      pdfBytesPosted: sum(pdfPosts.map(p => p.bytes)),
      pdfBytesTransferred: sum(pdfPosts.map(p => p.transferred)),
      pdfBytesCloned: sum(pdfPosts.map(p => p.bytes - p.transferred))
    },
    // Main-thread pdf.js documents only: inside the render worker pdf.js runs its parser without
    // a nested Worker that Playwright can see, so worker-side getDocument() counts come from the
    // unit-level harness (src/services/pdf/pdfPipeline.metrics.test.ts).
    pdfjsDocumentsOpenedMainThread: m.pdfjsWorkersMain,
    storedImages: {
      ...stored,
      avgBytesPerPage: stored.count ? Math.round(stored.totalBytes / stored.count) : 0
    }
  }
}

async function report(name: string, data: unknown): Promise<void> {
  const outDir = path.resolve('test-results/pdf-metrics')
  await fs.mkdir(outDir, { recursive: true })
  const out = path.join(outDir, `${name}.json`)
  await fs.writeFile(out, JSON.stringify(data, null, 2))
  console.log(`[pdf-metrics] ${name}: ${JSON.stringify(data)}`)
}

test('metrics: sample3.pdf (8.5 MB, 32 pages)', async ({ page }) => {
  test.setTimeout(10 * 60_000)
  const result = await measure(page, path.resolve('tests/e2e/samples/sample3.pdf'), 32, 9 * 60_000)
  await report('sample3', result)
  expect(result.storedImages.count).toBe(32)
})

test(`metrics: generated ${LARGE_PAGE_COUNT}-page PDF`, async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000)
  const pdfPath = testInfo.outputPath(`generated-${LARGE_PAGE_COUNT}.pdf`)
  await buildLargePdf(pdfPath, LARGE_PAGE_COUNT)
  const result = await measure(page, pdfPath, LARGE_PAGE_COUNT, 29 * 60_000)
  await report(`generated-${LARGE_PAGE_COUNT}`, result)
  expect(result.storedImages.count).toBe(LARGE_PAGE_COUNT)
})

/**
 * #51: a PDF above the old 100 MB limit. Every page embeds its own copy of a 3.3 MB photo,
 * so the file is ~3.3 MB x pages (60 pages ~ 200 MB). Opt-in separately: PDF_METRICS_HUGE=1.
 */
test('metrics: >100 MB PDF (above the old limit)', async ({ page }, testInfo) => {
  test.skip(process.env.PDF_METRICS_HUGE !== '1', 'Set PDF_METRICS_HUGE=1 to build and upload a ~200 MB PDF')
  test.setTimeout(30 * 60_000)
  const pages = Number(process.env.PDF_METRICS_HUGE_PAGES || 60)
  const pdfPath = testInfo.outputPath(`huge-${pages}.pdf`)
  const doc = await PDFDocument.create()
  const photo = await fs.readFile(path.resolve('tests/e2e/samples/sample2.jpg'))
  for (let i = 0; i < pages; i++) {
    const jpg = await doc.embedJpg(photo) // embedded per page on purpose: no sharing, big file
    doc.addPage([595, 842]).drawImage(jpg, { x: 0, y: 0, width: 595, height: 842 })
  }
  await fs.writeFile(pdfPath, await doc.save())

  const result = await measure(page, pdfPath, pages, 29 * 60_000)
  await report(`huge-${pages}`, result)
  expect(result.fileBytes).toBeGreaterThan(100 * 1024 * 1024)
  expect(result.storedImages.count).toBe(pages)
  expect(result.storedImages.errorPages).toBe(0)
})
