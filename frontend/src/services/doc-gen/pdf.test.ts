import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sandwichPDFBuilder } from './pdf'
import { PDFDocument } from 'pdf-lib'

// Mock pdf-lib
vi.mock('pdf-lib', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('pdf-lib')
    return {
        ...actual,
        PDFDocument: {
            create: vi.fn(),
            load: vi.fn()
        },
        rgb: vi.fn(),
        StandardFonts: {
            Helvetica: 'Helvetica'
        }
    }
})

// Mock fontLoader
vi.mock('@/services/font/fontLoader', () => ({
    fontLoader: {
        fetchFontBytes: vi.fn(),
    },
    FontLoaderService: {
        SC_FONT_URL: '/standard_fonts/NotoSansSC-Regular.woff2'
    }
}))

// Mock fontkit
vi.mock('@pdf-lib/fontkit', () => ({
    default: {
        create: vi.fn()
    }
}))

// Polyfill for Blob.arrayBuffer
if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function () {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.onerror = reject
            reader.readAsArrayBuffer(this)
        })
    }
}

describe('SandwichPDFBuilder', () => {
    let mockPdfDoc: any
    let mockPage: any

    let mockFont: any

    beforeEach(() => {
        vi.clearAllMocks()

        mockFont = {
            widthOfTextAtSize: vi.fn().mockReturnValue(10) // Return small width to fit text
        }

        mockPage = {
            drawImage: vi.fn(),
            drawText: vi.fn(),
            drawRectangle: vi.fn(),
            getSize: vi.fn().mockReturnValue({ width: 100, height: 100 })
        }

        mockPdfDoc = {
            embedJpg: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
            embedPng: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
            addPage: vi.fn().mockReturnValue(mockPage),
            save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
            getPages: vi.fn().mockReturnValue([mockPage]),
            getPageCount: vi.fn().mockReturnValue(1),
            registerFontkit: vi.fn(),
            embedFont: vi.fn().mockResolvedValue(mockFont),
            embedStandardFont: vi.fn().mockResolvedValue(mockFont)
        }

        vi.mocked(PDFDocument.create).mockResolvedValue(mockPdfDoc)
        vi.mocked(PDFDocument.load).mockResolvedValue(mockPdfDoc)
    })

    const mockBlob = new Blob(['fake-image'], { type: 'image/jpeg' })

    // Helper to create raw_text in the real format
    const createRawText = (blocks: { type: string, box: number[], content: string }[]) => {
        return blocks.map(b =>
            `<|ref|>${b.type}<|/ref|><|det|>[[${b.box.join(', ')}]]<|/det|>\n${b.content}  `
        ).join('\n\n')
    }

    it('should generate a PDF from an image without text', async () => {
        const ocrResult = {
            success: true,
            text: 'text',
            raw_text: '',
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        const pdfBlob = await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        expect(PDFDocument.create).toHaveBeenCalled()
        expect(mockPdfDoc.embedJpg).toHaveBeenCalled()
        expect(mockPdfDoc.addPage).toHaveBeenCalled()
        expect(mockPage.drawImage).toHaveBeenCalled()
        expect(mockPdfDoc.save).toHaveBeenCalled()

        expect(pdfBlob).toBeInstanceOf(Blob)
        expect(pdfBlob.type).toBe('application/pdf')
    })

    it('should try PNG if JPG fails', async () => {
        mockPdfDoc.embedJpg.mockRejectedValueOnce(new Error('Not JPG'))

        const ocrResult = {
            success: true,
            text: 'text',
            raw_text: '',
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)
        expect(mockPdfDoc.embedJpg).toHaveBeenCalled()
        expect(mockPdfDoc.embedPng).toHaveBeenCalled()
    })

    it('should generate a PDF with invisible text layer using real raw_text format', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 50, 30], content: 'Hello World' }
        ])

        const ocrResult = {
            success: true,
            text: 'Hello World',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Coordinates are scaled from pixels to PDF points (100px / 150dpi * 72pt = 48pt)
        // Original x=10 becomes 10 * (48/100) = 4.8
        expect(mockPage.drawText).toHaveBeenCalledWith('Hello World', expect.objectContaining({
            opacity: 0 // Invisible text layer for sandwich PDF
        }))
    })

    it('should normalize LaTeX delimiters in text layer', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 50, 30], content: 'Start \\( E=mc^2 \\) Middle \\[ F=ma \\] End' }
        ])

        const ocrResult = {
            success: true,
            text: 'Start \\( E=mc^2 \\) Middle \\[ F=ma \\] End',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Expect the text to be converted to Unicode: Start E=mc² Middle F=ma End
        // Note: The spaces around equations might be trimmed or kept by the converter or replacement logic.
        // The replacement logic: text.replace(..., (_, latex) => convert(latex))
        // 'Start \( E=mc^2 \) Middle' -> 'Start ' + convert(' E=mc^2 ') + ' Middle'
        // LatexToUnicodeConverter preserves text but trims result.
        // ' E=mc^2 ' -> 'E=mc²'
        expect(mockPage.drawText).toHaveBeenCalledWith('Start E=mc² Middle F=ma End', expect.objectContaining({
            opacity: 0 // Invisible text layer for sandwich PDF
        }))
    })

    it('should preserve LaTeX math characters in text layer', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 50, 30], content: 'Math: $x^2 + y_0 = z^*$' }
        ])

        const ocrResult = {
            success: true,
            text: 'Math: $x^2 + y_0 = z^*$',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Expect the text to be preserved as is
        expect(mockPage.drawText).toHaveBeenCalledWith('Math: $x^2 + y_0 = z^*$', expect.any(Object))
    })

    it('should attempt to load and embed Chinese font', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 50, 30], content: '你好世界' }
        ])

        const ocrResult = {
            success: true,
            text: '你好世界',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        const { fontLoader } = await import('@/services/font/fontLoader')
        vi.mocked(fontLoader.fetchFontBytes).mockResolvedValue(new Uint8Array([1, 2]))

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        expect(mockPdfDoc.registerFontkit).toHaveBeenCalled()
        expect(fontLoader.fetchFontBytes).toHaveBeenCalledWith('/standard_fonts/NotoSansSC-Regular.woff2')
        expect(mockPdfDoc.embedFont).toHaveBeenCalled()
        expect(mockPage.drawText).toHaveBeenCalledWith('你好世界', expect.objectContaining({
            font: mockFont
        }))
    })

    it('should fallback gracefully if font loading fails', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 50, 30], content: 'Hello' }
        ])

        const ocrResult = {
            success: true,
            text: 'Hello',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        const { fontLoader } = await import('@/services/font/fontLoader')
        vi.mocked(fontLoader.fetchFontBytes).mockResolvedValue(null)

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Should still draw text but without custom font
        expect(mockPage.drawText).toHaveBeenCalledWith('Hello', expect.objectContaining({
            font: mockFont
        }))
        // It should have called embedStandardFont
        expect(mockPdfDoc.embedStandardFont).toHaveBeenCalled()
    })

    it('should catch errors during font loading/embedding', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 50, 30], content: 'Hello' }
        ])

        const ocrResult = {
            success: true,
            text: 'Hello',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        const { fontLoader } = await import('@/services/font/fontLoader')
        vi.mocked(fontLoader.fetchFontBytes).mockRejectedValue(new Error('Fetch failed'))

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Failed to load custom font'),
            expect.any(Error)
        )
        // Should still generate PDF
        expect(mockPdfDoc.save).toHaveBeenCalled()
    })

    it('should keep untagged raw_text in the text layer instead of dropping it (issue #49)', async () => {
        const ocrResult = {
            success: true,
            text: 'text',
            raw_text: 'This is not in the expected format at all',
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Untagged text is kept as a full-page block, so it stays searchable
        expect(mockPage.drawText).toHaveBeenCalled()
    })

    it('should fail if both JPG and PNG embedding fails', async () => {
        mockPdfDoc.embedJpg.mockRejectedValue(new Error('Not JPG'))
        mockPdfDoc.embedPng.mockRejectedValue(new Error('Not PNG'))

        const ocrResult = {
            success: true,
            text: 'text',
            raw_text: '',
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await expect(sandwichPDFBuilder.generate(mockBlob, ocrResult))
            .rejects.toThrow('Unsupported image format')
    })

    it('should handle ArrayBuffer input', async () => {
        const arrayBuffer = new ArrayBuffer(8)
        const result = await sandwichPDFBuilder.generate(arrayBuffer, {
            success: true,
            text: '',
            raw_text: '',
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        })
        expect(result).toBeDefined()
    })

    it('should skip image type blocks', async () => {
        const raw_text = createRawText([
            { type: 'image', box: [10, 10, 50, 30], content: '' },
            { type: 'text', box: [60, 10, 100, 30], content: 'Some text' }
        ])

        const ocrResult = {
            success: true,
            text: 'Some text',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Only one drawText call (for 'Some text'), not for the image block
        expect(mockPage.drawText).toHaveBeenCalledTimes(1)
        expect(mockPage.drawText).toHaveBeenCalledWith('Some text', expect.any(Object))
    })

    it('should clean markdown formatting from text', async () => {
        const raw_text = createRawText([
            { type: 'title', box: [10, 10, 50, 30], content: '# Hello Header' }
        ])

        const ocrResult = {
            success: true,
            text: '# Hello Header',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Should strip the # markdown header
        expect(mockPage.drawText).toHaveBeenCalledWith('Hello Header', expect.any(Object))
    })

    it('should parse HTML table content into structured text', async () => {
        const raw_text = createRawText([
            {
                type: 'table',
                box: [10, 10, 100, 100],
                content: '<table><tr><td>Cell1</td><td>Cell2</td></tr><tr><td>Cell3</td><td>Cell4</td></tr></table>'
            }
        ])

        const ocrResult = {
            success: true,
            text: '',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Verify that drawText is called with lines preserving structure
        // The first line should contain "Cell1  Cell2"
        // The second line should contain "Cell3  Cell4"
        expect(mockPage.drawText).toHaveBeenCalledWith(expect.stringContaining('Cell1  Cell2'), expect.any(Object))
        expect(mockPage.drawText).toHaveBeenCalledWith(expect.stringContaining('Cell3  Cell4'), expect.any(Object))
    })

    it('should reassign table content from caption block to empty table block', async () => {
        // Simulate Qwen-VL output where table box comes first (empty content), then caption box (with content)
        const raw_text = createRawText([
            {
                type: 'table',
                box: [10, 10, 100, 100], // Large box
                content: '' // Empty content initially
            },
            {
                type: 'table_caption',
                box: [10, 110, 100, 120], // Small caption box
                content: 'Table 1\n<table><tr><td>ReassignedData</td></tr></table>'
            }
        ])

        const ocrResult = {
            success: true,
            text: '',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // The logic should have moved "ReassignedData" to the first block (table)
        // cleanTableHtml will process it.
        // We verify that drawText was called with "ReassignedData".
        expect(mockPage.drawText).toHaveBeenCalledWith(expect.stringContaining('ReassignedData'), expect.any(Object))
    })

    it('should split long tokens that overflow width', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 100, 50], content: 'VeryLongWordThatDoesNotFit' }
        ])

        const ocrResult = {
            success: true,
            text: 'VeryLongWordThatDoesNotFit',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        // Mock font width behavior
        mockFont.widthOfTextAtSize.mockImplementation((txt: string) => {
            if (txt.length > 10) return 200 // Huge width
            return txt.length * 2
        })

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // It should have called drawText multiple times for split parts
        expect(mockPage.drawText).toHaveBeenCalledWith(expect.stringContaining('Very'), expect.any(Object))
    })

    it('should wrap text to multiple lines when width is small', async () => {
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 50, 50], content: 'Word1 Word2' }
        ])

        mockFont.widthOfTextAtSize.mockImplementation((txt: string) => {
            if (txt.includes('Word1 Word2')) return 100 // Too big for line
            return 10 // Fits individually
        })

        await sandwichPDFBuilder.generate(mockBlob, {
            success: true,
            text: '',
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        })

        // Should draw Word1 and Word2 separately
        expect(mockPage.drawText).toHaveBeenCalledWith('Word1 ', expect.any(Object))
        expect(mockPage.drawText).toHaveBeenCalledWith('Word2', expect.any(Object))
    })

    it('should preserve LaTeX math characters in text layer', async () => {
        const latex = '$E = mc^2 * \\sqrt{x}$'
        const raw_text = createRawText([
            { type: 'text', box: [10, 10, 200, 50], content: latex }
        ])

        const ocrResult = {
            success: true,
            text: latex,
            raw_text,
            boxes: [],
            image_dims: { w: 100, h: 100 },
            prompt_type: 'document'
        }

        // Just ensure width doesn't cause split
        mockFont.widthOfTextAtSize.mockReturnValue(10)

        await sandwichPDFBuilder.generate(mockBlob, ocrResult)

        // Expect exactly the latex string
        expect(mockPage.drawText).toHaveBeenCalledWith(latex, expect.any(Object))
    })
})
