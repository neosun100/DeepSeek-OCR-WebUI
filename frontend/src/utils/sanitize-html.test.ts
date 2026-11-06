import { describe, it, expect } from 'vitest'
import { sanitizeRenderedHtml } from './sanitize-html'

describe('sanitizeRenderedHtml', () => {
    it('removes event handlers and script tags', () => {
        const out = sanitizeRenderedHtml('<p>a<img src="x" onerror="alert(1)"><script>alert(1)</script></p>')
        expect(out).toBe('<p>a<img src="x"></p>')
    })

    it('keeps blob: and data: image sources used by the preview', () => {
        expect(sanitizeRenderedHtml('<img src="blob:http://localhost/abc">')).toContain('src="blob:http://localhost/abc"')
        expect(sanitizeRenderedHtml('<img src="data:image/png;base64,AAAA">')).toContain('src="data:image/png;base64,AAAA"')
    })

    it('keeps unresolved scan2doc-img references inert but present', () => {
        expect(sanitizeRenderedHtml('<img src="scan2doc-img:missing">')).toContain('src="scan2doc-img:missing"')
    })

    /* eslint-disable sonarjs/code-eval -- XSS payload fixtures; never evaluated */
    it.each([
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        ' javascript:alert(1)',
        'vbscript:msgbox(1)',
        'data:text/html,<script>alert(1)</script>'
    ])('rejects dangerous link scheme %s', (href) => {
        const out = sanitizeRenderedHtml(`<a href="${href}">x</a>`)
        expect(out).toBe('<a>x</a>')
    })
    /* eslint-enable sonarjs/code-eval */

    it('keeps table spans and MathML', () => {
        const table = '<table><tbody><tr><td colspan="2" rowspan="2">a</td></tr></tbody></table>'
        expect(sanitizeRenderedHtml(table)).toBe(table)
        const math = '<math><semantics><msup><mi>x</mi><mn>2</mn></msup>'
            + '<annotation encoding="application/x-tex">x^2</annotation></semantics></math>'
        expect(sanitizeRenderedHtml(math)).toBe(math)
    })

    it('still drops annotation-xml (HTML-in-MathML mXSS vector)', () => {
        const out = sanitizeRenderedHtml(
            '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>'
        )
        expect(out).not.toContain('annotation-xml')
        expect(out).not.toContain('onerror')
    })
})
