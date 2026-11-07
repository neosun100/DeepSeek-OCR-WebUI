import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION_LABEL } from './version'

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name)
        return statSync(p).isDirectory() ? walk(p) : [p]
    })
}

// Guards user-visible labels only: comments are stripped so a historical note
// ("pages created before v5.0 used .png") cannot turn the scan red.
const stripLineComment = (line: string): string => {
    // '//' preceded by ':' is a URL (https://...), not a comment
    let i = line.indexOf('//')
    while (i > 0 && line[i - 1] === ':') i = line.indexOf('//', i + 2)
    return i === -1 ? line : line.slice(0, i)
}
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(stripLineComment).join('\n')

describe('version label', () => {
    it('is v5.0 · OCR-2', () => {
        expect(APP_VERSION_LABEL).toBe('v5.0 · OCR-2')
    })

    it('has no stale hard-coded v4.x labels left in src', () => {
        // Comments are stripped first: this guards user-visible labels, and a historical
        // note like "pages created before v5.0 used .png" must not turn it red (false red
        // seen when merging the F3 branch, 2026-11-07).
        const stale = walk(__dirname)
            .filter(p => /\.(vue|ts)$/.test(p) && !p.endsWith('.test.ts'))
            .filter(p => /v4\.\d/.test(stripComments(readFileSync(p, 'utf-8'))))
        expect(stale).toEqual([])
    })

    it('stale-label scan still catches a real label (negative control)', () => {
        expect(/v4\.\d/.test(stripComments("<span>v4.1 · OCR-2</span> // ok"))).toBe(true)
        expect(/v4\.\d/.test(stripComments('// before v4.2 we used png'))).toBe(false)
    })
})
