import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { PageProcessingLog, PageOutput } from '@/stores/pages'
import { isWebkit } from '@/utils/browser'
import { getRandomId } from '@/utils/crypto'
import { normalizeWarnings, type OCRWarning } from '@/services/ocr/types'

export interface DBFile {
  id?: string
  name: string
  content: Blob | ArrayBuffer
  size: number
  type: string
  createdAt: Date
}

export interface DBPage {
  id?: string
  fileId?: string // Reference to DBFile
  pageNumber?: number // Page number in the original file
  fileName: string
  fileSize: number
  fileType: string
  origin: 'upload' | 'pdf_generated' | 'scanner'
  status:
  | 'pending_render' | 'rendering' | 'ready'
  | 'pending_ocr' | 'recognizing' | 'ocr_success'
  | 'pending_gen' | 'generating_markdown' | 'markdown_success'
  | 'generating_pdf' | 'pdf_success' | 'generating_docx'
  | 'completed' | 'error'
  progress: number
  order: number  // Sort order for drag and drop
  imageData?: string  // base64 image data
  thumbnailData?: string  // base64 thumbnail data
  width?: number
  height?: number
  ocrText?: string
  outputs: PageOutput[]
  logs: PageProcessingLog[]
  createdAt: Date
  updatedAt: Date
  processedAt?: Date
}

export interface PageImage {
  pageId: string
  blob: Blob | ArrayBuffer
}

export interface PageOCR {
  pageId: string
  data: import('@/services/ocr').OCRResult
  createdAt: Date
}

export interface PageOCRSummary {
  warnings: OCRWarning[]
  finishReason: string | null
  ok: boolean | null
}

export interface PageMarkdown {
  pageId: string
  content: string
}



export interface PagePDF {
  pageId: string
  content: Blob | ArrayBuffer
}

export interface PageDOCX {
  pageId: string
  content: Blob | ArrayBuffer
}

export interface PageExtractedImage {
  id: string
  pageId: string
  blob: Blob | ArrayBuffer
  box: [number, number, number, number]
}

export class Scan2DocDB extends Dexie {
  files!: EntityTable<DBFile, 'id'>
  pages!: EntityTable<DBPage, 'id'>
  pageImages!: EntityTable<PageImage, 'pageId'>
  counters!: EntityTable<{ id: string; value: number }, 'id'>

  // New tables for Phase 1
  pageOCRs!: EntityTable<PageOCR, 'pageId'>
  pageMarkdowns!: EntityTable<PageMarkdown, 'pageId'>

  pagePDFs!: EntityTable<PagePDF, 'pageId'>
  pageDOCXs!: EntityTable<PageDOCX, 'pageId'>
  pageExtractedImages!: EntityTable<PageExtractedImage, 'id'>

  constructor() {
    super('Scan2Doc')

    // Define the initial schema as Version 1
    this.version(1).stores({
      files: 'id, name, type, createdAt',
      pages: 'id, fileName, fileId, status, order, createdAt',
      pageImages: 'pageId',
      counters: 'id',
      // New tables
      pageOCRs: 'pageId',
      pageMarkdowns: 'pageId',

      pagePDFs: 'pageId',
      pageDOCXs: 'pageId',
      pageExtractedImages: 'id, pageId'
    })
  }

  // File methods
  async saveFile(file: DBFile): Promise<string> {
    const cleanFile = { ...file }

    // Ensure ID exists
    if (!cleanFile.id) {
      cleanFile.id = generateFileId()
    }

    if (isWebkit() && cleanFile.content instanceof Blob) {
      try {
        cleanFile.content = await cleanFile.content.arrayBuffer()
      } catch (e) {
        console.error('[DB-ERROR] Failed to convert file content to arrayBuffer', e)
      }
    }

    if (file.id) { // If original file had ID, it's an update
      await this.files.put(cleanFile)
    } else {
      // New file
      await this.files.add(cleanFile)
    }

    return cleanFile.id
  }

  async getFile(id: string): Promise<DBFile | undefined> {
    const file = await this.files.get(id)
    return file ? this.ensureBlobContent(file) : undefined
  }

  private ensureBlobContent(file: DBFile): DBFile {
    if (file.content instanceof ArrayBuffer) {
      file.content = new Blob([file.content], { type: file.type })
    }
    return file
  }

  async deleteFile(id: string): Promise<void> {
    await this.files.delete(id)
  }

  // Page Image methods
  async savePageImage(pageId: string, blob: Blob): Promise<void> {
    try {
      let dataToSave: Blob | ArrayBuffer = blob
      if (isWebkit()) {
        dataToSave = await blob.arrayBuffer()
      }
      await this.pageImages.put({ pageId, blob: dataToSave })
    } catch (error) {
      console.error(`[DB-ERROR] Failed to save image for page ${pageId}:`, error)
      throw error
    }
  }

  async getPageImage(pageId: string): Promise<Blob | undefined> {
    try {
      const record = await this.pageImages.get(pageId)
      if (!record) return undefined

      const isBuffer = record.blob instanceof ArrayBuffer ||
        (typeof record.blob === 'object' && record.blob !== null && 'byteLength' in record.blob && !('size' in record.blob))

      if (isBuffer) {
        return new Blob([record.blob], { type: 'image/png' })
      }
      return record.blob as Blob
    } catch (error) {
      console.error(`[DB-ERROR] Failed to get image for page ${pageId}:`, error)
      return undefined
    }
  }

  // OCR Results methods
  async savePageOCR(data: PageOCR): Promise<void> {
    await this.pageOCRs.put(data)
  }

  async getPageOCR(pageId: string): Promise<PageOCR | undefined> {
    return await this.pageOCRs.get(pageId)
  }

  /**
   * Output-check summary of a page's OCR result (v5 warnings / finish_reason).
   * No schema change: warnings live inside pageOCRs.data. Records saved by v4 or before v5
   * have no warnings and yield an empty list.
   */
  async getPageOCRSummary(pageId: string): Promise<PageOCRSummary | undefined> {
    const record = await this.pageOCRs.get(pageId)
    if (!record) return undefined
    return {
      warnings: normalizeWarnings(record.data?.warnings),
      finishReason: record.data?.finish_reason ?? null,
      ok: typeof record.data?.ok === 'boolean' ? record.data.ok : null
    }
  }

  // Generated Documents methods
  async savePageMarkdown(data: PageMarkdown): Promise<void> {
    await this.pageMarkdowns.put(data)
  }

  async getPageMarkdown(pageId: string): Promise<PageMarkdown | undefined> {
    return await this.pageMarkdowns.get(pageId)
  }



  async savePagePDF(pageId: string, content: Blob | ArrayBuffer): Promise<void> {
    let dataToSave = content
    if (isWebkit() && content instanceof Blob) {
      dataToSave = await content.arrayBuffer()
    }
    await this.pagePDFs.put({ pageId, content: dataToSave })
  }

  async getPagePDF(pageId: string): Promise<Blob | undefined> { // Return Blob for ease of use
    const record = await this.pagePDFs.get(pageId)
    if (!record) return undefined

    const isBuffer = record.content instanceof ArrayBuffer ||
      (typeof record.content === 'object' && record.content !== null && 'byteLength' in record.content && !('size' in record.content))

    if (isBuffer) {
      return new Blob([record.content], { type: 'application/pdf' })
    }
    return record.content as Blob
  }

  async savePageDOCX(pageId: string, content: Blob | ArrayBuffer): Promise<void> {
    let dataToSave = content
    if (isWebkit() && content instanceof Blob) {
      dataToSave = await content.arrayBuffer()
    }
    await this.pageDOCXs.put({ pageId, content: dataToSave })
  }

  async getPageDOCX(pageId: string): Promise<Blob | undefined> {
    const record = await this.pageDOCXs.get(pageId)
    if (!record) return undefined

    const isBuffer = record.content instanceof ArrayBuffer ||
      (typeof record.content === 'object' && record.content !== null && 'byteLength' in record.content && !('size' in record.content))

    if (isBuffer) {
      return new Blob([record.content], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    }
    return record.content as Blob
  }

  // Extracted Images methods
  async savePageExtractedImage(data: PageExtractedImage): Promise<void> {
    let dataToSave = data
    if (isWebkit() && data.blob instanceof Blob) {
      const buffer = await data.blob.arrayBuffer()
      dataToSave = { ...data, blob: buffer }
    }
    await this.pageExtractedImages.put(dataToSave)
  }

  async getPageExtractedImage(id: string): Promise<PageExtractedImage | undefined> {
    const record = await this.pageExtractedImages.get(id)
    if (!record) return undefined

    const isBuffer = record.blob instanceof ArrayBuffer ||
      (typeof record.blob === 'object' && record.blob !== null && 'byteLength' in record.blob && !('size' in record.blob))

    if (isBuffer) {
      return { ...record, blob: new Blob([record.blob], { type: 'image/png' }) }
    }
    return record as unknown as PageExtractedImage
  }

  // Page methods
  async savePage(page: DBPage): Promise<string> {
    const cleanPage = { ...page } as DBPage
    if (cleanPage.order === undefined || cleanPage.order === -1) {
      cleanPage.order = await this.getNextOrder()
    }
    if (!cleanPage.id) {
      cleanPage.id = generatePageId()
    }
    await this.pages.put(cleanPage)
    return cleanPage.id
  }

  async savePagesBatch(pages: Omit<DBPage, 'id' | 'order'>[]): Promise<string[]> {
    return await this.transaction('rw', [this.pages, this.counters], async (tx) => {
      const startOrder = await this.getNextOrderBatch(pages.length, tx)
      const cleanPages = pages.map((page, index) => {
        const clean = {
          ...page,
          order: startOrder + index,
          createdAt: page.createdAt || new Date(),
          updatedAt: new Date()
        } as DBPage
        if (!clean.id) {
          clean.id = generatePageId()
        }
        return clean
      })
      await this.pages.bulkPut(cleanPages)
      return cleanPages.map(p => p.id!)
    })
  }

  private async getNextOrderBatch(count: number, tx?: Transaction): Promise<number> {
    const operation = async (transaction: Transaction) => {
      const countersTable = transaction.table('counters')
      const counterId = 'pages_order'
      const record = await countersTable.get(counterId)
      const current = record ? record.value : 0
      await countersTable.put({ id: counterId, value: current + count })
      return current
    }

    if (tx) {
      return await operation(tx)
    }

    return await this.transaction('rw', this.counters, async (transaction) => {
      return await operation(transaction)
    })
  }

  async getNextOrder(): Promise<number> {
    return await this.getNextOrderBatch(1)
  }

  async getPage(id: string): Promise<DBPage | undefined> {
    return await this.pages.get(id)
  }

  async getAllPages(): Promise<DBPage[]> {
    return await this.pages.orderBy('order').toArray()
  }

  async getPagesByStatus(status: DBPage['status']): Promise<DBPage[]> {
    return await this.pages.where('status').equals(status).toArray()
  }

  async deletePage(id: string): Promise<void> {
    await this.transaction('rw', [
      this.pages,
      this.pageImages,
      this.pageOCRs,
      this.pageMarkdowns,
      this.pagePDFs,
      this.pageDOCXs,
      this.pageExtractedImages
    ], async () => {
      await this.pages.delete(id)
      await this.pageImages.delete(id)
      // Cleanup related data
      await this.pageOCRs.delete(id)
      await this.pageMarkdowns.delete(id)
      await this.pagePDFs.delete(id)
      await this.pageDOCXs.delete(id)
      await this.pageExtractedImages.where('pageId').equals(id).delete()
    })
  }

  async deletePagesBatch(ids: string[]): Promise<void> {
    await this.transaction('rw', [
      this.pages,
      this.pageImages,
      this.pageOCRs,
      this.pageMarkdowns,
      this.pagePDFs,
      this.pageDOCXs,
      this.pageExtractedImages
    ], async () => {
      await this.pages.bulkDelete(ids)
      await this.pageImages.bulkDelete(ids)
      // Cleanup related data
      await this.pageOCRs.bulkDelete(ids)
      await this.pageMarkdowns.bulkDelete(ids)
      await this.pagePDFs.bulkDelete(ids)
      await this.pageDOCXs.bulkDelete(ids)
      await this.pageExtractedImages.where('pageId').anyOf(ids).delete()
    })
  }

  async deleteAllPages(): Promise<void> {
    await this.transaction('rw', [this.pages, this.pageImages, this.counters], async () => {
      await this.pages.clear()
      await this.pageImages.clear()
      await this.counters.clear() // Clean up counters too
    })
  }


  async saveAddedPage(pageData: Omit<DBPage, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<string> {
    const order = await this.getNextOrder()
    const dbPage: DBPage = {
      ...pageData,
      id: generatePageId(),
      order,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    await this.pages.add(dbPage)
    return dbPage.id!
  }

  async getAllPagesForDisplay(): Promise<DBPage[]> {
    return await this.getAllPages()
  }

  async updatePagesOrder(pageOrders: { id: string; order: number }[]): Promise<void> {
    await this.transaction('rw', this.pages, async () => {
      for (const { id, order } of pageOrders) {
        await this.pages.update(id, { order, updatedAt: new Date() })
      }
    })
  }

  async clearAllData(): Promise<void> {
    await this.deleteAllPages()
  }

  async updatePage(id: string, updates: Partial<DBPage>): Promise<number> {
    return await this.pages.update(id, { ...updates, updatedAt: new Date() })
  }

  async getStorageSize(): Promise<number> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate()
      return estimate.usage || 0
    }
    return 0
  }
}

export const db = new Scan2DocDB()

function getSecureRandomPart(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const array = new Uint32Array(1)
    crypto.getRandomValues(array)
    return array[0]!.toString(36)
  }
  // Fallback for insecure contexts
  // eslint-disable-next-line sonarjs/pseudo-random
  return Math.random().toString(36).substring(2, 10)
}

export function generatePageId(): string {
  const randomPart = getSecureRandomPart()
  return `page_${Date.now()}_${randomPart}_${getRandomId()}`
}

export function generateFileId(): string {
  const randomPart = getSecureRandomPart()
  return `file_${Date.now()}_${randomPart}_${getRandomId()}`
}
