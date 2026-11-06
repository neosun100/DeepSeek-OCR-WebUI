import DOMPurify from 'dompurify'

/**
 * Sanitizes HTML produced by markdown-it before it is bound via `v-html`.
 *
 * Why: markdown-it runs with `html: true` so OCR tables (<table>/<td colspan>)
 * survive, but the OCR model copies whatever is printed on the scanned page.
 * An image containing `<img src=x onerror=alert(1)>` would otherwise execute
 * in the user's origin (and could read IndexedDB / API settings).
 *
 * What is kept (DOMPurify defaults cover all of these):
 * - HTML tables incl. colspan / rowspan / width
 * - KaTeX output: span + class + style, and the MathML subtree
 * - data: URLs on <img> (DOMPurify DATA_URI_TAGS)
 *
 * What we add on top of the defaults:
 * - `blob:` URLs: Preview swaps `scan2doc-img:<id>` for object URLs created
 *   from IndexedDB blobs; the default URI allowlist would strip them.
 * - `scan2doc-img:` URLs: left in place when an extracted image is missing;
 *   the browser cannot resolve the scheme so it is inert, and keeping it
 *   preserves the reference for debugging.
 * `javascript:`, `vbscript:` and any other scheme stay rejected.
 */
const ALLOWED_URI_REGEXP =
    // Same shape as DOMPurify's IS_ALLOWED_URI, plus blob: and scan2doc-img:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|blob|scan2doc-img):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

export function sanitizeRenderedHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        ALLOWED_URI_REGEXP,
        // KaTeX wraps every formula's MathML in <semantics> with the TeX source in
        // <annotation encoding="application/x-tex">. DOMPurify drops both by
        // default, which leaks the raw TeX as loose text into the (visually
        // hidden, but screen-reader visible) MathML. <annotation> is text-only
        // per the MathML spec; <annotation-xml> (the mXSS vector) stays banned.
        ADD_TAGS: ['semantics', 'annotation'],
        ADD_ATTR: ['encoding']
    })
}
