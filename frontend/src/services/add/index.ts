import type { Page } from '@/stores/pages'
import { addLogger } from '@/utils/logger'
import { FILE_LIMITS, formatMegabytes } from './limits'

export interface FileAddResult {
  success: boolean
  pages: Page[]
  error?: string
}

export interface FileProcessingOptions {
  maxFileSize?: number // in bytes
  allowedTypes?: string[]
  generateThumbnails?: boolean
  thumbnailSize?: { width: number; height: number }
}

class FileAddService {
  private readonly defaultOptions: FileProcessingOptions = {
    maxFileSize: FILE_LIMITS.maxImageBytes,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'application/pdf'],
    generateThumbnails: true,
    thumbnailSize: { width: 200, height: 300 }
  }

  /**
   * Trigger file selection dialog
   */
  triggerFileSelect(multiple = true): Promise<File[]> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = this.defaultOptions.allowedTypes!.join(',')
      input.multiple = multiple

      input.onchange = () => {
        const files = Array.from(input.files || [])
        resolve(files)
      }

      input.oncancel = () => {
        resolve([])
      }

      input.onerror = () => {
        reject(new Error('File selection failed'))
      }

      input.click()
    })
  }

  /**
   * Validate file against options
   */
  private validateFile(file: File, options: FileProcessingOptions): { valid: boolean; error?: string } {
    // Use appropriate size limit based on file type
    const maxFileSize = file.type === 'application/pdf'
      ? FILE_LIMITS.maxPdfBytes
      : (options.maxFileSize || this.defaultOptions.maxFileSize!)

    if (file.size > maxFileSize) {
      return {
        valid: false,
        error: `File "${file.name}" is too large (${formatMegabytes(file.size)}). Maximum size is ${formatMegabytes(maxFileSize)}`
      }
    }

    if (!options.allowedTypes!.includes(file.type)) {
      return {
        valid: false,
        error: `File "${file.name}" has unsupported type: ${file.type}`
      }
    }

    return { valid: true }
  }

  /**
   * Generate thumbnail from image file as base64
   */
  private async generateThumbnail(file: File, maxSize: { width: number; height: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const img = new Image()

      const objectUrl = URL.createObjectURL(file)

      img.onload = () => {
        try {
          // Calculate thumbnail dimensions maintaining aspect ratio
          const { width, height } = this.calculateDimensions(
            img.width,
            img.height,
            maxSize.width,
            maxSize.height
          )

          canvas.width = width
          canvas.height = height

          // Draw and resize image
          ctx.drawImage(img, 0, 0, width, height)

          // Convert to base64
          const base64 = canvas.toDataURL('image/jpeg', 0.8)
          resolve(base64)
        } finally {
          URL.revokeObjectURL(objectUrl)
        }
      }

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('Failed to load image for thumbnail generation'))
      }

      // Load the image
      img.src = objectUrl
    })
  }

  /**
   * Convert file to base64
   */
  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          reject(new Error('Failed to convert file to base64'))
        }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }

  /**
   * Calculate dimensions maintaining aspect ratio
   */
  private calculateDimensions(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    const widthRatio = maxWidth / originalWidth
    const heightRatio = maxHeight / originalHeight
    const ratio = Math.min(widthRatio, heightRatio, 1) // Don't upscale

    return {
      width: Math.round(originalWidth * ratio),
      height: Math.round(originalHeight * ratio)
    }
  }

  /**
   * Get image dimensions
   */
  private getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()

      const objectUrl = URL.createObjectURL(file)

      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        resolve({ width: img.width, height: img.height })
      }

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('Failed to load image'))
      }

      img.src = objectUrl
    })
  }

  /**
   * Process a single image file into a Page
   */
  private async processImageFile(file: File, options: FileProcessingOptions): Promise<Page> {
    const imageDimensions = await this.getImageDimensions(file)

    // Convert image to base64 for persistent storage (deprecated for pages table, but used for pageImages)
    // Actually, we can use the file (Blob) directly for pageImages table

    let thumbnailData: string | undefined

    if (options.generateThumbnails) {
      try {
        thumbnailData = await this.generateThumbnail(file, options.thumbnailSize!)
      } catch (error) {
        addLogger.warn('Failed to generate thumbnail for', file.name, error)
        // Fall back to base64 for thumbnail if generation fails
        thumbnailData = await this.fileToBase64(file)
      }
    } else {
      thumbnailData = await this.fileToBase64(file)
    }

    const { db, generatePageId } = await import('@/db/index')
    const pageId = generatePageId()

    // Save full image to separate table as Blob
    try {
      await db.savePageImage(pageId, file)
    } catch (error) {
      addLogger.error('Failed to save full image to DB:', error)
    }

    return {
      id: pageId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      origin: 'upload',
      status: 'ready',
      progress: 100,
      order: -1, // Will be set by store
      thumbnailData,
      width: imageDimensions.width,
      height: imageDimensions.height,
      outputs: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }

  /**
   * Process PDF file into multiple Page objects
   */
  private async processPDFFile(file: File, _options: FileProcessingOptions): Promise<Page[]> {
    try {
      // Import PDF service dynamically to avoid circular dependencies
      const { pdfService } = await import('@/services/pdf')

      // Validates, opens the PDF once in the render worker and queues all pages.
      // Throws for invalid/corrupted PDFs; the page count comes from that single parse.
      const pageCount = await pdfService.processPDF(file)
      if (!pageCount) {
        throw new Error('PDF file appears to be empty or corrupted')
      }

      // Return empty array for now - pages will be created by the PDF processing queue
      // The pages store will be updated via events as pages are processed
      return []

    } catch (error) {
      addLogger.error('Error processing PDF file:', error)
      throw error
    }
  }

  /**
   * Process multiple files
   */
  async processFiles(files: File[], options: Partial<FileProcessingOptions> = {}): Promise<FileAddResult> {
    const mergedOptions = { ...this.defaultOptions, ...options }
    const pages: Page[] = []
    const errors: string[] = []

    if (!files || files.length === 0) {
      return { success: false, pages: [], error: 'No files provided' }
    }

    for (const file of files) {
      try {
        const result = await this.processSingleFile(file, mergedOptions)
        pages.push(...result)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    return {
      success: pages.length > 0 && errors.length === 0,
      pages,
      error: errors.length > 0 ? errors.join('; ') : undefined
    }
  }

  /**
   * Internal helper to process a single file (Image or PDF)
   */
  private async processSingleFile(file: File, options: FileProcessingOptions): Promise<Page[]> {
    const validation = this.validateFile(file, options)
    if (!validation.valid) {
      throw new Error(validation.error)
    }

    const lowerType = (file.type || '').toLowerCase()

    if (lowerType.startsWith('image/')) {
      const page = await this.processImageFile(file, options)
      return [page]
    }

    if (lowerType === 'application/pdf') {
      return await this.processPDFFile(file, options)
    }

    throw new Error(`Skipping unsupported file "${file.name}" (type: ${file.type})`)
  }
}

// Export singleton instance
export const fileAddService = new FileAddService()
export default fileAddService