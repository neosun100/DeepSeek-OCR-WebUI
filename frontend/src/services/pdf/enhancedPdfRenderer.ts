/**
 * Enhanced PDF Renderer - font support on the main thread.
 *
 * PDF parsing happens only in the render worker. The worker sends back a text sample of the
 * first pages; font availability detection needs `document`, so the choice is made here.
 */

import { fontLoader } from '../font/fontLoader'
import { pdfLogger } from '@/utils/logger'

export class EnhancedPdfRenderer {
  private static instance: EnhancedPdfRenderer

  static getInstance(): EnhancedPdfRenderer {
    if (!EnhancedPdfRenderer.instance) {
      EnhancedPdfRenderer.instance = new EnhancedPdfRenderer()
    }
    return EnhancedPdfRenderer.instance
  }

  /**
   * Initialize the enhanced renderer
   */
  async initialize(): Promise<void> {
    try {
      // Preload common fonts
      await fontLoader.preloadCommonFonts()
      pdfLogger.info('[Enhanced PDF Renderer] Font initialization completed')
    } catch (error) {
      pdfLogger.warn('[Enhanced PDF Renderer] Font initialization failed:', error)
    }
  }

  /**
   * Pick the best available fallback font for a document's sample text.
   * Falls back to 'sans-serif' (and logs) if detection fails, so rendering never blocks on fonts.
   */
  pickFallbackFont(sampleText: string): string {
    try {
      return fontLoader.getBestFont(sampleText)
    } catch (error) {
      pdfLogger.warn('[Enhanced PDF Renderer] Could not determine optimal font, using sans-serif:', error)
      return 'sans-serif'
    }
  }
}

// Export singleton instance
export const enhancedPdfRenderer = EnhancedPdfRenderer.getInstance()
