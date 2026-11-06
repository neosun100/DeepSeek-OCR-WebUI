// README screenshots are generated, not hand-made. Run against a REAL backend that also
// serves the built frontend (same origin), so every screenshot shows real model output:
//
//   cd frontend && npm run build && cd ..
//   uv run deepseek-ocr-webui serve &          # 127.0.0.1:8001, real model (CUDA / MPS)
//   cd frontend && node scripts/screenshots.mjs [--base http://127.0.0.1:8001] [--out ../assets/screenshots]
//
// Privacy rules (touchstone screenshots.md): headless Chromium captures only the page
// itself — never the desktop or other windows. Each image is size-checked after capture
// and deleted if it looks wrong; all images having the same size fails the run (= probably
// the same thing captured repeatedly).
import { chromium } from '@playwright/test'
import { mkdirSync, statSync, unlinkSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > -1 ? process.argv[i + 1] : def
}
const BASE = arg('base', 'http://127.0.0.1:8001')
const OUT = resolve(here, arg('out', '../../assets/screenshots'))
const SAMPLES = resolve(here, '../tests/e2e/samples')
mkdirSync(OUT, { recursive: true })

const shots = []
const log = (...a) => process.stdout.write(a.join(' ') + '\n')

async function shot(page, name, opts = {}) {
    const path = resolve(OUT, `${name}.png`)
    await page.screenshot({ path, ...opts })
    const { size } = statSync(path)
    // PNG header: width/height at bytes 16..24
    const buf = readFileSync(path)
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
    if (size < 8_000 || w < 300 || h < 300) {
        unlinkSync(path)
        throw new Error(`screenshot ${name} looks wrong (${w}x${h}, ${size} B) — deleted`)
    }
    shots.push({ name, w, h, size })
    log(`  ✓ ${name}.png ${w}x${h} ${(size / 1024).toFixed(0)} KB`)
}

async function waitStatus(page, idx, ok, timeout = 300_000) {
    await page.waitForFunction(
        ([i, okList]) => okList.includes(window.pagesStore?.pages?.[i]?.status ?? ''),
        [idx, ok],
        { timeout, polling: 500 },
    )
}

const DONE = ['completed']

async function main() {
    const health = await (await fetch(`${BASE}/health`)).json()
    if (!health.ready) throw new Error(`backend not ready: ${health.status} ${health.load_error ?? ''}`)
    log(`backend ready: engine=${health.engine?.engine} device=${health.engine?.device}`)

    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' })
    const page = await ctx.newPage()

    // 1. Empty state
    await page.goto(BASE)
    await page.getByTestId('welcome-title').waitFor()
    await page.getByTestId('health-indicator').waitFor()
    await page.waitForTimeout(800) // fonts / health poll
    await shot(page, '01-home')

    // 2. Import an image + a multi-page PDF
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByTestId('import-files-button').click(),
    ])
    await chooser.setFiles([resolve(SAMPLES, 'sample.png'), resolve(SAMPLES, 'sample2.pdf')])
    await page.waitForFunction(() => (window.pagesStore?.pages?.length ?? 0) >= 3, null, { timeout: 60_000 })
    await page.getByTestId('page-thumbnail').first().waitFor()
    await page.waitForTimeout(1500)

    // 3. OCR the table page (document mode, real model) and show the rendered preview
    await page.locator('[data-testid^="page-item-"]').first().click()
    await page.getByTestId('page-viewer').waitFor()
    await page.getByTestId('ocr-trigger-btn').click()
    await waitStatus(page, 0, DONE)
    await page.waitForTimeout(1200)
    await shot(page, '02-document-ocr')

    // 4. Mode selector open
    await page.getByTestId('ocr-mode-dropdown').click()
    await page.locator('.n-dropdown-menu').waitFor({ state: 'visible' })
    await page.waitForTimeout(400)
    await shot(page, '03-modes')
    await page.keyboard.press('Escape')

    // 5. Batch OCR of the PDF pages + queue popover
    await page.getByTestId('select-all-checkbox').check()
    await page.getByTestId('batch-ocr-btn').click()
    await page.getByTestId('ocr-queue-badge').waitFor()
    await page.waitForTimeout(1500)
    await page.getByTestId('ocr-queue-badge').click()
    await page.getByTestId('ocr-queue-popover').waitFor()
    await page.waitForTimeout(600)
    await shot(page, '04-batch-queue')
    await page.getByTestId('ocr-queue-close-btn').click().catch(() => {})
    const n = await page.evaluate(() => window.pagesStore.pages.length)
    for (let i = 0; i < n; i++) await waitStatus(page, i, DONE)

    // 6. A PDF page result
    await page.locator('[data-testid^="page-item-"]').nth(1).click()
    await page.waitForTimeout(1500)
    await shot(page, '05-pdf-page')

    // 7. Health tooltip (engine / device / dtype)
    await page.getByTestId('health-indicator').hover()
    await page.getByTestId('health-tooltip').waitFor({ state: 'visible' })
    await page.waitForTimeout(400)
    await shot(page, '06-health')

    // 8. Swagger docs
    const api = await ctx.newPage()
    await api.goto(`${BASE}/docs`)
    await api.locator('.swagger-ui .opblock').first().waitFor()
    await api.waitForTimeout(800)
    await shot(api, '07-api-docs')

    // 9. Mobile layout
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, locale: 'zh-CN' })
    const m = await mobile.newPage()
    await m.goto(BASE)
    await m.getByTestId('welcome-title').waitFor()
    await m.waitForTimeout(800)
    await shot(m, '08-mobile-zh')

    await browser.close()

    const sizes = new Set(shots.map(s => `${s.w}x${s.h}`))
    if (shots.length > 1 && sizes.size === 1) throw new Error('all screenshots have the same size — probably the same capture')
    log(`done: ${shots.length} screenshots → ${OUT}`)
}

main().catch(e => {
    process.stderr.write(`❌ ${e.stack || e}\n`)
    process.exit(1)
})
