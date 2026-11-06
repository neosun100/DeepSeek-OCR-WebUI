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

describe('version label', () => {
    it('is v5.0 · OCR-2', () => {
        expect(APP_VERSION_LABEL).toBe('v5.0 · OCR-2')
    })

    it('has no stale hard-coded v4.x labels left in src', () => {
        const stale = walk(__dirname)
            .filter(p => /\.(vue|ts)$/.test(p) && !p.endsWith('.test.ts'))
            .filter(p => /v4\.\d/.test(readFileSync(p, 'utf-8')))
        expect(stale).toEqual([])
    })
})
