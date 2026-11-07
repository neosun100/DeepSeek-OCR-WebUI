import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnhancedPdfRenderer, enhancedPdfRenderer } from '@/services/pdf/enhancedPdfRenderer'
import { fontLoader } from '@/services/font/fontLoader'
import { pdfLogger } from '@/utils/logger'

vi.mock('@/services/font/fontLoader', () => ({
  fontLoader: {
    preloadCommonFonts: vi.fn(),
    getBestFont: vi.fn(),
  }
}))

vi.mock('@/utils/logger', () => ({
  pdfLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}))

describe('EnhancedPdfRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fontLoader.getBestFont).mockReset()
  })

  it('getInstance: should return the same instance', () => {
    const instance1 = EnhancedPdfRenderer.getInstance()
    const instance2 = EnhancedPdfRenderer.getInstance()
    expect(instance1).toBe(instance2)
    expect(instance1).toBe(enhancedPdfRenderer)
  })

  it('initialize: should preload common fonts', async () => {
    await enhancedPdfRenderer.initialize()
    expect(fontLoader.preloadCommonFonts).toHaveBeenCalled()
    expect(pdfLogger.info).toHaveBeenCalledWith(expect.stringContaining('Font initialization completed'))
  })

  it('initialize: should log initialization errors', async () => {
    vi.mocked(fontLoader.preloadCommonFonts).mockRejectedValueOnce(new Error('Init failed'))
    await enhancedPdfRenderer.initialize()
    expect(pdfLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Font initialization failed'), expect.any(Error))
  })

  it('pickFallbackFont: should delegate to fontLoader with the sample text', () => {
    vi.mocked(fontLoader.getBestFont).mockReturnValue('PingFang SC')
    expect(enhancedPdfRenderer.pickFallbackFont('中文')).toBe('PingFang SC')
    expect(fontLoader.getBestFont).toHaveBeenCalledWith('中文')
  })

  it('pickFallbackFont: should fall back to sans-serif and log when detection throws', () => {
    vi.mocked(fontLoader.getBestFont).mockImplementation(() => { throw new Error('no document') })
    expect(enhancedPdfRenderer.pickFallbackFont('x')).toBe('sans-serif')
    expect(pdfLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not determine optimal font'), expect.any(Error))
  })
})
