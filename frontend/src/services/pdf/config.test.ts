import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  CMAP_URL,
  CMAP_PACKED,
  STANDARD_FONT_DATA_URL,
  DOCUMENT_INIT_PARAMS,
  PAGE_RENDER_CONFIG,
  computeRenderScale,
  imageMimeType,
  imageExtension
} from '@/services/pdf/config'

describe('PDF Service Config', () => {
  it('should export correct constants', () => {
    expect(CMAP_URL).toBe('cmaps/')
    expect(CMAP_PACKED).toBe(true)
    expect(STANDARD_FONT_DATA_URL).toBe('standard_fonts/')
  })

  it('main-thread PDF modules do not import pdf.js (it belongs to the render worker)', () => {
    for (const file of ['config.ts', 'index.ts', 'pdfQueue.ts', 'enhancedPdfRenderer.ts']) {
      const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
      expect(source, file).not.toMatch(/from 'pdfjs-dist/)
    }
  })

  it('should export correct document init params', () => {
    expect(DOCUMENT_INIT_PARAMS).toEqual({
      cMapUrl: 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'standard_fonts/',
      useSystemFonts: true,
      fontExtraProperties: true,
    })
  })

  it('renders pages as JPEG q0.92 with a 2304px long edge (DeepSeek-OCR-2 2x3 tile grid)', () => {
    expect(PAGE_RENDER_CONFIG.imageFormat).toBe('jpeg')
    expect(PAGE_RENDER_CONFIG.quality).toBe(0.92)
    expect(PAGE_RENDER_CONFIG.targetLongEdgePx).toBe(3 * 768)
  })

  describe('computeRenderScale', () => {
    it('A4 portrait/landscape: long edge maps to the target', () => {
      expect(842 * computeRenderScale(595, 842)).toBeCloseTo(2304)
      expect(842 * computeRenderScale(842, 595)).toBeCloseTo(2304)
    })

    it('oversized pages are scaled down instead of producing huge canvases', () => {
      // A0 poster: the old fixed scale 2.5 meant an 8427x5960 px canvas
      const scale = computeRenderScale(2384, 3370)
      expect(scale).toBeLessThan(1)
      expect(3370 * scale).toBeCloseTo(2304)
    })

    it('tiny pages are capped at maxScale', () => {
      expect(computeRenderScale(100, 100)).toBe(PAGE_RENDER_CONFIG.maxScale)
      expect(computeRenderScale(100, 100, 2304, 2)).toBe(2)
    })

    it('rejects invalid page sizes', () => {
      expect(() => computeRenderScale(0, 0)).toThrow('Invalid page size')
      expect(() => computeRenderScale(NaN, 10)).toThrow('Invalid page size')
    })
  })

  it('maps formats to MIME types and extensions', () => {
    expect(imageMimeType('jpeg')).toBe('image/jpeg')
    expect(imageMimeType('png')).toBe('image/png')
    expect(imageExtension('jpeg')).toBe('jpg')
    expect(imageExtension('png')).toBe('png')
  })
})
