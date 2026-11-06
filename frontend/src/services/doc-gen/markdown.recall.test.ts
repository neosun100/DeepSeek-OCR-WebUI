/**
 * Issue #49: exported Markdown must not lose content that exists in the OCR raw_text.
 *
 * Criterion: multiset recall of "effective characters" (Unicode letters + digits) of
 * raw_text (grounding tags removed) inside the generated Markdown must be >= 95%.
 * Inputs are the real samples in tests/e2e/samples plus two variants derived from them
 * that reproduce the shapes that triggered the bug (multi-box <|det|>, ocr-mode labels).
 */
import { describe, it, expect, afterAll } from 'vitest'
import { writeFileSync } from 'node:fs'
import { MarkdownAssembler } from './markdown'
import type { OCRResult } from '@/services/ocr'
import sample0 from '../../../tests/e2e/samples/sample.json'
import sample1 from '../../../tests/e2e/samples/sample1.json'
import sample2 from '../../../tests/e2e/samples/sample2.json'
import sample3 from '../../../tests/e2e/samples/sample3.json'
import sample4 from '../../../tests/e2e/samples/sample4.json'
import sample5 from '../../../tests/e2e/samples/sample5.json'

const MIN_RECALL = 0.95
// Independent oracle: mirrors server grounding.py LAYOUT_LABELS on purpose, so the test does not
// trust the implementation under test to decide what counts as content
const LAYOUT = new Set(['title', 'sub_title', 'text', 'table', 'table_caption', 'table_footnote', 'image',
    'image_caption', 'figure', 'figure_caption', 'formula', 'equation', 'header', 'footer', 'page_header',
    'page_footer', 'page_number', 'list', 'list_item', 'code', 'caption', 'footnote', 'reference', 'abstract',
    'author', 'algorithm', 'chart', 'seal', 'aside_text'])
const isLayoutLabel = (label: string) => LAYOUT.has(label.trim().toLowerCase())
const HEADER_RE = /<\|ref\|>([\s\S]*?)<\|\/ref\|>\s*<\|det\|>([\s\S]*?)<\|\/det\|>/g

const SAMPLES: Record<string, OCRResult> = {
    sample: sample0 as unknown as OCRResult,
    sample1: sample1 as unknown as OCRResult,
    sample2: sample2 as unknown as OCRResult,
    sample3: sample3 as unknown as OCRResult,
    sample4: sample4 as unknown as OCRResult,
    sample5: sample5 as unknown as OCRResult
}

function effectiveChars(text: string): Map<string, number> {
    const counts = new Map<string, number>()
    for (const ch of text.match(/[\p{L}\p{N}]/gu) ?? []) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
    return counts
}

function rawReference(raw: string): string {
    return stripTags(raw
        .replace(HEADER_RE, (_m, label: string) => (isLayoutLabel(label) ? ' ' : ` ${label} `))
        .replace(/<\|\/?(?:ref|det|grounding)\|>/g, ' '))
}

/** Remove HTML tags (and their attributes) without a backtracking regex. */
function stripTags(text: string): string {
    return text.split('<').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('>') + 1))).join(' ')
}

function markdownVisible(md: string): string {
    // Image links / attributes contain letters ("Figure", "scan2doc", "width") that must not
    // count as recovered content
    return stripTags(md.replace(/!\[Figure \d+\]\(scan2doc-img:[\w-]+\)/g, ' '))
}

function recall(raw: string, md: string): { recall: number; expected: number; found: number } {
    const want = effectiveChars(rawReference(raw))
    const got = effectiveChars(markdownVisible(md))
    let expected = 0
    let found = 0
    for (const [ch, n] of want) {
        expected += n
        found += Math.min(n, got.get(ch) ?? 0)
    }
    return { recall: expected === 0 ? 1 : found / expected, expected, found }
}

/** imageMap exactly as ImageProcessor.sliceImages builds it (image / figure boxes only). */
function imageMapFor(result: OCRResult): Map<string, string> {
    const map = new Map<string, string>()
    result.boxes.forEach((b, i) => {
        if (['image', 'figure'].includes(b.label.toLowerCase())) map.set(String(i), `img-${i}`)
    })
    return map
}

/**
 * Variant: every other box split into two stacked boxes, as OCR-2 emits for multi-line regions.
 * Only alternate blocks are converted: if ALL blocks failed to parse, the old code fell back to
 * returning raw_text verbatim, which hides the loss.
 */
function toMultiBox(result: OCRResult): OCRResult {
    let n = 0
    const raw = result.raw_text.replace(/<\|det\|>\[\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\]<\|\/det\|>/g,
        (m, a: string, b: string, c: string, d: string) => {
            if (n++ % 2 === 0) return m
            const mid = Math.round((Number(b) + Number(d)) / 2)
            return `<|det|>[[${a}, ${b}, ${c}, ${mid}], [${a}, ${mid}, ${c}, ${d}]]<|/det|>`
        })
    return { ...result, raw_text: raw }
}

/** Variant: ocr mode, where the <|ref|> label carries the recognized text and the body is empty. */
function toOcrMode(result: OCRResult): OCRResult {
    const parts: string[] = []
    for (const chunk of result.raw_text.split('<|ref|>').slice(1)) {
        const detStart = chunk.indexOf('<|det|>')
        const detEnd = chunk.indexOf('<|/det|>')
        if (detStart < 0 || detEnd < 0) continue
        const det = chunk.slice(detStart, detEnd + '<|/det|>'.length)
        const line = stripTags(chunk.slice(detEnd + '<|/det|>'.length)).split(/\s+/).join(' ').trim()
        if (line) parts.push(`<|ref|>${line}<|/ref|>${det}\n`)
    }
    return { ...result, raw_text: parts.join(''), prompt_type: 'ocr' }
}

const assembler = new MarkdownAssembler()
const measured: string[] = []

// Set RECALL_REPORT=<file> to dump the measured numbers (used for the issue #49 report)
afterAll(() => {
    const out = process.env.RECALL_REPORT
    if (out) writeFileSync(out, measured.join('\n') + '\n')
})

function check(name: string, result: OCRResult) {
    const md = assembler.assemble(result, imageMapFor(result))
    const r = recall(result.raw_text, md)
    measured.push(`${name}: ${(r.recall * 100).toFixed(1)}% (${r.found}/${r.expected})`)
    expect(r.expected).toBeGreaterThan(0)
    expect(r.recall).toBeGreaterThanOrEqual(MIN_RECALL)
}

describe('MarkdownAssembler content recall (issue #49)', () => {
    for (const [name, sample] of Object.entries(SAMPLES)) {
        it(`${name}: document-mode raw_text`, () => check(name, sample))
        it(`${name}: multi-box <|det|> variant`, () => check(`${name}/multibox`, toMultiBox(sample)))
        it(`${name}: ocr-mode label variant`, () => check(`${name}/ocr`, toOcrMode(sample)))
    }

    it('keeps content of a block whose coordinates cannot be parsed', () => {
        const result: OCRResult = {
            success: true,
            text: '',
            raw_text: '<|ref|>text<|/ref|><|det|>[[garbage]]<|/det|>\nKeep me 123',
            boxes: [],
            image_dims: { w: 1000, h: 1000 },
            prompt_type: 'document'
        }
        expect(assembler.assemble(result, new Map())).toContain('Keep me 123')
    })

    it('does not merge blocks below a heading into a row above it', () => {
        const result: OCRResult = {
            success: true,
            text: '',
            raw_text:
                '<|ref|>text<|/ref|><|det|>[[0, 0, 400, 300]]<|/det|>\nLEFT-TALL\n' +
                '<|ref|>sub_title<|/ref|><|det|>[[500, 100, 900, 120]]<|/det|>\n## HEADING\n' +
                '<|ref|>text<|/ref|><|det|>[[500, 200, 900, 260]]<|/det|>\nBELOW-HEADING\n',
            boxes: [],
            image_dims: { w: 1000, h: 1000 },
            prompt_type: 'document'
        }
        const md = assembler.assemble(result, new Map())
        expect(md.indexOf('HEADING')).toBeLessThan(md.indexOf('BELOW-HEADING'))
    })
})
