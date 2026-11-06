import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileAddService } from './index'
import { pdfService } from '@/services/pdf'
import { db } from '@/db/index'

// 1. Mock external dependencies
vi.mock('@/services/pdf', () => ({
    pdfService: {
        validatePDF: vi.fn(),
        processPDF: vi.fn()
    }
}))

// Mock database
vi.mock('@/db/index', () => ({
    db: {
        savePageImage: vi.fn()
    },
    generatePageId: vi.fn(() => 'mock-page-id')
}))

class MockFileReader {
    onload: ((ev: any) => void) | null = null
    onerror: ((ev: any) => void) | null = null
    result: string | ArrayBuffer | null = null
    readAsDataURL() {
        setTimeout(() => {
            this.result = new ArrayBuffer(0)
            if (this.onload) this.onload({} as any)
        }, 0)
    }
}

describe('FileAddService', () => {
    beforeEach(() => {
        vi.resetAllMocks()

        // Setup default mock implementations
        vi.mocked(pdfService.validatePDF).mockReturnValue({ valid: true })
        vi.mocked(pdfService.processPDF).mockResolvedValue(2)
        vi.mocked(db.savePageImage).mockResolvedValue(undefined as any)

        // Reset URL.createObjectURL
        window.URL.createObjectURL = vi.fn((file: any) => `mock-url-${file?.name || 'unknown'}`)
    })

    it('should recognize and handle PDF files', async () => {
        const mockFile = new File(['fake content'], 'test.pdf', { type: 'application/pdf' })
        const result = await fileAddService.processFiles([mockFile])

        expect(result.error).toBeUndefined()
        expect(result.pages).toEqual([])

        const { pdfService } = await import('@/services/pdf')
        expect(pdfService.processPDF).toHaveBeenCalledWith(mockFile)
    })

    it('Validation: should throw error if image exceeds 10MB', async () => {
        const largeImg = new File([new ArrayBuffer(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' })
        const result = await fileAddService.processFiles([largeImg])

        expect(result.success).toBe(false)
        expect(result.error).toContain('is too large')
    })

    it('Validation: PDF allowed up to 100MB', async () => {
        const midPdf = new File([new ArrayBuffer(50 * 1024 * 1024)], 'mid.pdf', { type: 'application/pdf' })
        const result = await fileAddService.processFiles([midPdf])
        expect(result.error).toBeUndefined()
    })

    it('Validation: should throw error if PDF exceeds 100MB', async () => {
        const hugePdf = new File([new ArrayBuffer(101 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' })
        const result = await fileAddService.processFiles([hugePdf])

        expect(result.success).toBe(false)
        expect(result.error).toContain('is too large')
    })

    it('Validation: should throw error if file type is unsupported', async () => {
        const badFile = new File([''], 'virus.exe', { type: 'application/x-msdownload' })
        const result = await fileAddService.processFiles([badFile])

        expect(result.success).toBe(false)
        expect(result.error).toContain('unsupported type')
    })

    it('Validation: should return unsuccessful for empty file list', async () => {
        const result = await fileAddService.processFiles([])
        expect(result.success).toBe(false)
        expect(result.pages).toHaveLength(0)
    })

    it('Validation: should be able to override default configuration', async () => {
        // Default limit is 10MB, we override it to 1KB
        const smallImg = new File([new ArrayBuffer(2048)], 'small.png', { type: 'image/png' })
        const result = await fileAddService.processFiles([smallImg], { maxFileSize: 1024 })

        expect(result.success).toBe(false)
        expect(result.error).toContain('is too large')
    })

    it('should process images using real implementation and cleanup resources', async () => {
        setupImageMocks()
        const revokeSpy = vi.fn()
        window.URL.revokeObjectURL = revokeSpy
        const mockImg = new File([''], 'photo.jpg', { type: 'image/jpeg' })

        const result = await fileAddService.processFiles([mockImg])

        expect(result.pages.length).toBe(1)
        expect(result.pages[0]?.thumbnailData).toBe('data:image/jpeg;base64,mock_thumb')
        expect(result.pages[0]!.width).toBe(100)
        expect(result.pages[0]!.height).toBe(100)
        expect(result.pages[0]!.order).toBe(-1) // Explicit check for order placeholder
        expect(revokeSpy).toHaveBeenCalled()
        vi.restoreAllMocks()
    })

    it('corrupted images should be skipped and throw error', async () => {
        setupImageMocks()
        const mockImg = new File([''], 'fail.jpg', { type: 'image/jpeg' })
        const result = await fileAddService.processFiles([mockImg])

        expect(result.pages).toHaveLength(0)
        expect(result.error).toContain('Failed to load image')
        expect(result.success).toBe(false)
        vi.restoreAllMocks()
    })

    it('if thumbnails are disabled, should use base64 fallback', async () => {
        setupImageMocks()
        const mockImg = new File([''], 'photo.jpg', { type: 'image/jpeg' })
        const result = await fileAddService.processFiles([mockImg], { generateThumbnails: false })
        expect(result.pages[0]?.thumbnailData).toBe('data:image/jpeg;base64,mocked_base64')
        vi.restoreAllMocks()
    })

    it('if thumbnail generation fails, should fall back to base64', async () => {
        setupImageMocks()
        const spyThumb = vi.spyOn(fileAddService as any, 'generateThumbnail').mockRejectedValue(new Error('Thumb failed'))
        const mockImg = new File([''], 'photo.jpg', { type: 'image/jpeg' })
        const result = await fileAddService.processFiles([mockImg])
        expect(result.pages[0]?.thumbnailData).toBe('data:image/jpeg;base64,mocked_base64')
        spyThumb.mockRestore()
        vi.restoreAllMocks()
    })

    it('fileToBase64 failure branch', async () => {
        setupImageMocks()
        vi.spyOn(fileAddService as any, 'getImageDimensions').mockResolvedValue({ width: 100, height: 100 })
        vi.spyOn(fileAddService as any, 'fileToBase64').mockRejectedValue(new Error('Failed to read file'))
        const mockImg = new File(['fake data'], 'fail.png', { type: 'image/png' })
        const result = await fileAddService.processFiles([mockImg], { generateThumbnails: false })
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Failed to read file/)
        vi.restoreAllMocks()
    })

    it('fileToBase64 non-string result branch', async () => {
        setupImageMocks()
        vi.spyOn(fileAddService as any, 'getImageDimensions').mockResolvedValue({ width: 100, height: 100 })

        // Defined outside to avoid nested function lint
        vi.stubGlobal('FileReader', MockFileReader)

        const mockImg = new File(['fake data'], 'fail.png', { type: 'image/png' })
        const result = await fileAddService.processFiles([mockImg], { generateThumbnails: false })

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Failed to convert file to base64/)
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('DB save failure should not interrupt the process', async () => {
        setupImageMocks()
        const { db } = await import('@/db/index')
        vi.mocked(db.savePageImage).mockRejectedValue(new Error('DB error'))

        const mockImg = new File(['fake data'], 'photo.jpg', { type: 'image/jpeg' })
        const result = await fileAddService.processFiles([mockImg])
        expect(result.pages.length).toBe(1)
        expect(result.pages[0]?.id).toBe('mock-page-id')
        vi.restoreAllMocks()
    })

    it('should throw error when PDF validation fails', async () => {
        const { pdfService } = await import('@/services/pdf')
        vi.mocked(pdfService.processPDF).mockRejectedValue(new Error('Invalid PDF structure'))
        const mockFile = new File([''], 'bad.pdf', { type: 'application/pdf' })
        const result = await fileAddService.processFiles([mockFile])
        expect(result.success).toBe(false)
        expect(result.error).toContain('Invalid PDF structure')
    })

    it('should throw error when PDF page count is 0', async () => {
        const { pdfService } = await import('@/services/pdf')
        vi.mocked(pdfService.processPDF).mockResolvedValue(0)
        const mockFile = new File([''], 'empty.pdf', { type: 'application/pdf' })
        const result = await fileAddService.processFiles([mockFile])
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/empty or corrupted/)
    })

    it('Mixed processing: failure should make success false', async () => {
        vi.spyOn(fileAddService as any, 'generateThumbnail').mockResolvedValue('data:mock_thumb')
        vi.spyOn(fileAddService as any, 'fileToBase64').mockResolvedValue('data:mock_full')
        vi.spyOn(fileAddService as any, 'getImageDimensions').mockResolvedValue({ width: 100, height: 100 })

        const validImg = new File([''], 'ok.png', { type: 'image/png' })
        const invalidFile = new File([''], 'bad.txt', { type: 'text/plain' })
        const result = await fileAddService.processFiles([validImg, invalidFile])

        expect(result.pages).toHaveLength(1)
        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
    })

    it('should hit the unsupported file branch if validation is bypassed', async () => {
        const txtFile = new File([''], 'test.txt', { type: 'text/plain' })
        const result = await fileAddService.processFiles([txtFile], { allowedTypes: ['text/plain'] })

        expect(result.success).toBe(false)
        expect(result.error).toMatch(/Skipping unsupported file/)
    })

    it('should correctly perform proportional scaling (landscape)', () => {
        const calc = (fileAddService as any).calculateDimensions
        const res = calc(1000, 500, 200, 300)
        expect(res).toEqual({ width: 200, height: 100 })
    })

    it('should correctly perform proportional scaling (portrait)', () => {
        const calc = (fileAddService as any).calculateDimensions
        const res = calc(500, 1000, 200, 300)
        expect(res).toEqual({ width: 150, height: 300 })
    })

    it('should not upscale images', () => {
        const calc = (fileAddService as any).calculateDimensions
        const res = calc(100, 100, 200, 300)
        expect(res).toEqual({ width: 100, height: 100 })
    })

    it('triggerFileSelect: should trigger selection and return list', async () => {
        const mockFiles = [new File([''], 'test.png', { type: 'image/png' })]
        const mockInput = setupInputMock(mockFiles)
        const promise = fileAddService.triggerFileSelect()
        if (mockInput.onchange) (mockInput.onchange as any)({ target: { files: mockFiles } })
        const result = await promise
        expect(result).toEqual(mockFiles)
        expect(mockInput.type).toBe('file')
        expect(mockInput.multiple).toBe(true)
    })

    it('triggerFileSelect: should support single selection', async () => {
        const mockInput = setupInputMock([])
        fileAddService.triggerFileSelect(false)
        expect(mockInput.multiple).toBe(false)
    })

    it('triggerFileSelect: should return empty array on cancel', async () => {
        const mockInput = setupInputMock([])
        const promise = fileAddService.triggerFileSelect()
        if (mockInput.oncancel) (mockInput.oncancel as any)()
        const result = await promise
        expect(result).toEqual([])
    })

    it('triggerFileSelect: should reject on error', async () => {
        const mockInput = setupInputMock([])
        const promise = fileAddService.triggerFileSelect()
        if (mockInput.onerror) (mockInput as any).onerror()
        await expect(promise).rejects.toThrow('File selection failed')
    })
})

function setupImageMocks() {
    (window as any).Image = class {
        onload: ((ev: any) => unknown) | null = null
        onerror: ((ev: any) => unknown) | null = null
        _src: string = ''
        width: number = 100
        height: number = 100
        set src(s: string) {
            this._src = s
            setTimeout(() => {
                if (s && s.includes('fail')) {
                    if (this.onerror) this.onerror({} as any)
                } else {
                    if (this.onload) this.onload({} as any)
                }
            }, 0)
        }
        get src() { return this._src }
    };

    (window as any).FileReader = class {
        onload: ((ev: any) => unknown) | null = null
        onerror: ((ev: any) => unknown) | null = null
        result: string | ArrayBuffer | null = null
        readAsDataURL(file: File) {
            setTimeout(() => {
                if (file.name === 'fail.png') {
                    if (this.onerror) this.onerror({} as any)
                } else {
                    this.result = `data:${file.type};base64,mocked_base64`
                    if (this.onload) this.onload({} as any)
                }
            }, 0)
        }
    };

    const mockCanvas = {
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => 'data:image/jpeg;base64,mock_thumb',
        width: 0,
        height: 0
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'canvas') return mockCanvas as any
        if (tag === 'input') return { type: '', accept: '', multiple: false, click: vi.fn(), onchange: null } as any
        return {} as any
    })
}

function setupInputMock(files: File[]) {
    const mockInput = {
        click: vi.fn(),
        type: '',
        accept: '',
        multiple: false,
        files: files,
        onchange: null as unknown,
        oncancel: null as unknown,
        onerror: null as unknown
    }
    vi.spyOn(document, 'createElement').mockReturnValue(mockInput as any)
    return mockInput
}
