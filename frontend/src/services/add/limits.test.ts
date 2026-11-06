import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { FILE_LIMITS, BYTES_PER_MB, formatMegabytes } from './limits'

const SRC_DIR = path.resolve(__dirname, '../..')
const LIMITS_FILE = path.resolve(__dirname, 'limits.ts')

// A megabyte-sized limit literal: `N * 1024 * 1024`, `1024 * 1024 * N`, or `N * BYTES_PER_MB`
const SIZE_LITERALS = [
  /\d{1,6} ?\* ?1024 ?\* ?1024/g,
  /1024 ?\* ?1024 ?\* ?\d/g,
  /\d{1,6} ?\* ?BYTES_PER_MB/g
]

function findSizeLiterals(text: string): string[] {
  return SIZE_LITERALS.flatMap(re => text.match(re) ?? [])
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    const isSource = /\.(ts|vue)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)
    return isSource ? [full] : []
  })
}

describe('FILE_LIMITS', () => {
  it('PDF limit is 500MB, image limit is 10MB', () => {
    expect(FILE_LIMITS.maxPdfBytes).toBe(500 * BYTES_PER_MB)
    expect(FILE_LIMITS.maxImageBytes).toBe(10 * BYTES_PER_MB)
    expect(formatMegabytes(FILE_LIMITS.maxPdfBytes)).toBe('500MB')
  })

  it('size-limit literals exist only in limits.ts (single source of truth)', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC_DIR)) {
      if (file === LIMITS_FILE) continue
      const matches = findSizeLiterals(fs.readFileSync(file, 'utf8'))
      if (matches.length) offenders.push(`${path.relative(SRC_DIR, file)}: ${matches.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('the scanner actually detects limit literals', () => {
    // Guards against the regex silently matching nothing
    expect(findSizeLiterals('const max = 100 * 1024 * 1024')).toHaveLength(1)
    expect(findSizeLiterals('maxFileSize: 1024 * 1024 * 50')).toHaveLength(1)
    expect(findSizeLiterals('maxPdfBytes: 500 * BYTES_PER_MB')).toHaveLength(1)
    expect(findSizeLiterals('const BYTES_PER_MB = 1024 * 1024')).toEqual([])
  })
})
