import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pdfService } from '@/services/pdf/index'
import { queuePDFPages, resumePDFProcessing } from '@/services/pdf/pdfQueue'
import { pdfEvents } from '@/services/pdf/events'
import { db } from '@/db/index'
import { pdfLogger } from '@/utils/logger'

vi.mock('@/services/pdf/pdfQueue', () => ({
  queuePDFPages: vi.fn(),
  resumePDFProcessing: vi.fn()
}))

vi.mock('@/services/pdf/events', () => ({
  pdfEvents: { emit: vi.fn() }
}))

vi.mock('@/db/index', () => ({
  db: {
    saveFile: vi.fn().mockResolvedValue('file-id-123'),
    deleteFile: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('@/utils/logger', () => ({
  pdfLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('@/services/pdf/enhancedPdfRenderer', () => ({
  enhancedPdfRenderer: { initialize: vi.fn().mockResolvedValue(undefined) }
}))

/** jsdom's File has no arrayBuffer(); browsers do */
function pdfFile(content = '%PDF-1.7 test', name = 'test.pdf'): File {
  const file = new File([content], name, { type: 'application/pdf' })
  const bytes = new ArrayBuffer(content.length)
  Object.defineProperty(file, 'arrayBuffer', { value: vi.fn().mockResolvedValue(bytes) })
  return file
}

describe('PDFService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.saveFile).mockResolvedValue('file-id-123')
    vi.mocked(queuePDFPages).mockResolvedValue(3)
  })

  it('validatePDF: should fail if file is null/undefined', () => {
    expect(pdfService.validatePDF(undefined as unknown as File)).toEqual({ valid: false, error: 'Please select a file!' })
  })

  it('validatePDF: should fail for non-pdf types', () => {
    const file = new File([''], 'test.txt', { type: 'text/plain' })
    expect(pdfService.validatePDF(file)).toEqual({ valid: false, error: expect.stringContaining('Please select a valid PDF file') })
  })

  it('validatePDF: should accept .pdf extension regardless of MIME type', () => {
    const file = new File(['x'], 'SCAN.PDF', { type: '' })
    expect(pdfService.validatePDF(file)).toEqual({ valid: true })
  })

  it('validatePDF: should fail for empty files', () => {
    const file = new File([''], 'empty.pdf', { type: 'application/pdf' })
    expect(pdfService.validatePDF(file)).toEqual({ valid: false, error: expect.stringContaining('is empty') })
  })

  it('validatePDF: should fail for large files > 100MB', () => {
    const file = { name: 'large.pdf', type: 'application/pdf', size: 101 * 1024 * 1024 } as File
    expect(pdfService.validatePDF(file)).toEqual({ valid: false, error: expect.stringContaining('too large') })
  })

  it('processPDF: reads the file once, hands the bytes to the queue and returns the page count', async () => {
    const file = pdfFile()
    const count = await pdfService.processPDF(file)

    expect(count).toBe(3)
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1)
    expect(db.saveFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'test.pdf', content: file }))
    expect(queuePDFPages).toHaveBeenCalledWith(file, expect.any(ArrayBuffer), 'file-id-123')
  })

  it('processPDF: should continue without resume support if saving the source fails', async () => {
    vi.mocked(db.saveFile).mockRejectedValue(new Error('DB Error'))
    const file = pdfFile()

    await expect(pdfService.processPDF(file)).resolves.toBe(3)
    expect(pdfLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to save source file'), expect.any(Error))
    expect(queuePDFPages).toHaveBeenCalledWith(file, expect.any(ArrayBuffer), undefined)
  })

  it('processPDF: corrupt PDF -> emits processing-error, removes the orphaned source file, rethrows', async () => {
    vi.mocked(queuePDFPages).mockRejectedValue(new Error('Invalid PDF structure'))
    const file = pdfFile()

    await expect(pdfService.processPDF(file)).rejects.toThrow('Failed to load PDF "test.pdf": Invalid PDF structure')
    expect(db.deleteFile).toHaveBeenCalledWith('file-id-123')
    expect(pdfEvents.emit).toHaveBeenCalledWith('pdf:processing-error', expect.objectContaining({
      error: expect.stringContaining('Invalid PDF structure')
    }))
  })

  it('processPDF: invalid file is rejected before anything is read or stored', async () => {
    const file = new File([''], 'empty.pdf', { type: 'application/pdf' })

    await expect(pdfService.processPDF(file)).rejects.toThrow('is empty')
    expect(db.saveFile).not.toHaveBeenCalled()
    expect(queuePDFPages).not.toHaveBeenCalled()
  })

  it('processPDF: never converts the file to base64', async () => {
    const dataUrlSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    await pdfService.processPDF(pdfFile())
    expect(dataUrlSpy).not.toHaveBeenCalled()
    dataUrlSpy.mockRestore()
  })

  it('resumeProcessing: should call pdfQueue.resumePDFProcessing', async () => {
    await pdfService.resumeProcessing()
    expect(resumePDFProcessing).toHaveBeenCalled()
  })
})
