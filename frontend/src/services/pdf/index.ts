import { queuePDFPages, resumePDFProcessing } from './pdfQueue'
import { pdfEvents } from './events'
import { db } from '@/db/index'
import { pdfLogger } from '@/utils/logger'

// Initialize enhanced PDF renderer (font preloading for the fallback-font choice)
import { enhancedPdfRenderer } from './enhancedPdfRenderer'

// Initialize enhanced renderer when module loads
enhancedPdfRenderer.initialize().catch(err => pdfLogger.error(err))

export interface PDFPageInfo {
  pageNumber: number
  width: number
  height: number
  imageData?: string  // base64 image data
  thumbnailData?: string  // base64 thumbnail data
}

export interface PDFProcessingOptions {
  dpi?: number
  thumbnailSize?: number
  imageFormat?: 'png' | 'jpeg'
  quality?: number
  scale?: number
}

/**
 * PDF entry point on the main thread.
 *
 * The main thread never parses the PDF: it reads the file once and transfers the bytes to the
 * render worker, which parses it once, reports the page count and renders every page from that
 * single document.
 */
export class PDFService {
  /**
   * Process PDF file and queue all pages for rendering.
   * Returns the page count. Throws (after emitting `pdf:processing-error`) if the PDF is invalid.
   */
  async processPDF(file: File): Promise<number> {
    try {
      const validation = this.validatePDF(file)
      if (!validation.valid) {
        throw new Error(validation.error!)
      }

      // Save original file to DB for resume support (stored as Blob, no extra JS heap copy)
      let fileId: string | undefined
      try {
        fileId = await db.saveFile({
          name: file.name,
          content: file, // File is a Blob
          size: file.size,
          type: file.type,
          createdAt: new Date()
        })
        pdfLogger.info(`Saved source file to DB: ${file.name} (id: ${fileId})`)
      } catch (dbError) {
        pdfLogger.warn('Failed to save source file to DB, resume will not work:', dbError)
      }

      // The only main-thread copy of the PDF bytes; it is transferred (detached) to the worker
      const pdfData = await file.arrayBuffer()

      let pageCount: number
      try {
        pageCount = await queuePDFPages(file, pdfData, fileId)
      } catch (error) {
        // Do not leave an orphaned source file behind for a PDF that never got pages
        if (fileId) {
          await db.deleteFile(fileId).catch(e => pdfLogger.warn('Failed to delete orphaned source file:', e))
        }
        throw new Error(`Failed to load PDF "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      pdfEvents.emit('pdf:log', {
        pageId: `pdf_${file.name}_${Date.now()}`,
        message: `Started processing PDF "${file.name}" with ${pageCount} pages`,
        level: 'info'
      })
      return pageCount

    } catch (error) {
      pdfLogger.error('Error processing PDF:', error)

      pdfEvents.emit('pdf:processing-error', {
        file,
        error: error instanceof Error ? error.message : 'Unknown processing error'
      })
      throw error
    }
  }

  /**
   * Resume processing of any interrupted PDF pages
   */
  async resumeProcessing(): Promise<void> {
    await resumePDFProcessing()
  }

  /**
   * Validate PDF file
   */
  validatePDF(file: File): { valid: boolean; error?: string } {
    if (!file) {
      return {
        valid: false,
        error: 'Please select a file!'
      }
    }

    // Enhanced: case-insensitive check for file extension
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      return {
        valid: false,
        error: `Please select a valid PDF file! Current file type: ${file.type || 'unknown'}`
      }
    }

    if (file.size === 0) {
      return {
        valid: false,
        error: `File "${file.name}" is empty`
      }
    }

    // Check file size limit (100MB)
    const maxSize = 100 * 1024 * 1024
    if (file.size > maxSize) {
      return {
        valid: false,
        error: `File "${file.name}" is too large, maximum supported size is ${Math.round(maxSize / 1024 / 1024)}MB`
      }
    }

    return { valid: true }
  }
}

// Export singleton instance
export const pdfService = new PDFService()
