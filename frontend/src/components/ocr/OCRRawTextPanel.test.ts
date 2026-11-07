import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import OCRRawTextPanel from './OCRRawTextPanel.vue'
import { i18n } from '@/i18n'

// Mock Naive UI message
const messageMock = {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
}

vi.mock('naive-ui', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual as any,
        useMessage: () => messageMock
    }
})

describe('OCRRawTextPanel.vue', () => {
    const defaultProps = {
        text: 'Sample OCR Text'
    }

    // Mock navigator.clipboard
    const writeTextMock = vi.fn()
    const originalClipboard = navigator.clipboard

    beforeEach(() => {
        vi.clearAllMocks()
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: writeTextMock
            },
            writable: true
        })
    })

    afterEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: originalClipboard,
            writable: true
        })
    })

    it('renders correctly', () => {
        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })
        expect(wrapper.find('.ocr-raw-text-panel').exists()).toBe(true)
        expect(wrapper.find('.panel-title').text()).toBe('OCR Raw Result')
    })

    it('toggles expand/collapse', async () => {
        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })

        // Default is expanded
        expect((wrapper.vm as any).expanded).toBe(true)

        // Convert to any to access private/internal elements if needed,
        // but better to interact via UI
        await wrapper.find('.panel-header').trigger('click')
        expect((wrapper.vm as any).expanded).toBe(false)

        await wrapper.find('.panel-header').trigger('click')
        expect((wrapper.vm as any).expanded).toBe(true)
    })

    it('copies text to clipboard using navigator API', async () => {
        writeTextMock.mockResolvedValue(undefined)

        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })

        const copyButton = wrapper.find('.panel-header .n-button') // Finding the copy button
        await copyButton.trigger('click')

        expect(writeTextMock).toHaveBeenCalledWith('Sample OCR Text')
        expect(messageMock.success).not.toHaveBeenCalled()
        expect((wrapper.vm as any).isCopied).toBe(true)
    })

    it('handles empty text copy gracefully', async () => {
        const wrapper = mount(OCRRawTextPanel, {
            props: { text: '' },
            global: { plugins: [i18n] }
        })

        const copyButton = wrapper.find('.panel-header button')
        await copyButton.trigger('click')

        expect(writeTextMock).not.toHaveBeenCalled()
    })

    it('handles copy error', async () => {
        writeTextMock.mockRejectedValue(new Error('Copy failed'))

        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })

        const copyButton = wrapper.find('.panel-header button')
        await copyButton.trigger('click')

        expect(writeTextMock).toHaveBeenCalled()
        expect(messageMock.error).toHaveBeenCalledWith('Copy failed')
    })

    it('falls back to document.execCommand when navigator.clipboard is unavailable', async () => {
        // Mock clipboard unavailable
        Object.defineProperty(navigator, 'clipboard', {
            value: undefined,
            writable: true
        })

        const execCommandMock = vi.fn().mockReturnValue(true)
        document.execCommand = execCommandMock

        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })

        const copyButton = wrapper.find('.panel-header .n-button')
        await copyButton.trigger('click')

        expect(execCommandMock).toHaveBeenCalledWith('copy')
        expect(messageMock.success).not.toHaveBeenCalled()
        expect((wrapper.vm as any).isCopied).toBe(true)
    })

    it('updates copy icon on hover', async () => {
        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })

        const copyButton = wrapper.find('.panel-header .n-button')

        await copyButton.trigger('mouseenter')
        expect((wrapper.vm as any).isCopyHovered).toBe(true)

        await copyButton.trigger('mouseleave')
        expect((wrapper.vm as any).isCopyHovered).toBe(false)
    })

    it('handles fallback copy error', async () => {
        // Mock clipboard unavailable
        Object.defineProperty(navigator, 'clipboard', {
            value: undefined,
            writable: true
        })

        const error = new Error('ExecCommand failed')
        const execCommandMock = vi.fn().mockImplementation(() => {
            throw error
        })
        document.execCommand = execCommandMock

        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })

        const copyButton = wrapper.find('.panel-header .n-button')
        await copyButton.trigger('click')

        expect(messageMock.error).toHaveBeenCalledWith('Copy failed')
    })

    it('resets isCopied state after timeout', async () => {
        vi.useFakeTimers()
        writeTextMock.mockResolvedValue(undefined)

        const wrapper = mount(OCRRawTextPanel, {
            props: defaultProps,
            global: { plugins: [i18n] }
        })

        const copyButton = wrapper.find('.panel-header .n-button')
        await copyButton.trigger('click')

        expect((wrapper.vm as any).isCopied).toBe(true)

        vi.advanceTimersByTime(2000)
        await wrapper.vm.$nextTick()

        expect((wrapper.vm as any).isCopied).toBe(false)
        vi.useRealTimers()
    })

    describe('output checks (v5)', () => {
        it('lists warnings (failing first) and the finish reason', () => {
            const wrapper = mount(OCRRawTextPanel, {
                props: {
                    text: 'x',
                    finishReason: 'repetition_cut',
                    warnings: [
                        { code: 'near_empty', message: 'few chars' },
                        { code: 'repetition_cut', message: 'tail repetition cut' }
                    ]
                },
                global: { plugins: [i18n] }
            })
            const codes = wrapper.findAll('[data-testid="raw-text-warning"]').map(w => w.attributes('data-code'))
            expect(codes).toEqual(['repetition_cut', 'near_empty'])
            expect(wrapper.text()).toContain('tail repetition cut')
            expect(wrapper.find('[data-testid="raw-text-finish-reason"]').attributes('data-reason')).toBe('repetition_cut')
            expect(wrapper.find('[data-testid="raw-text-finish-reason"]').text()).toContain(
                i18n.global.t('ocrRawTextPanel.finishRepetitionCut')
            )
        })

        it('renders no output-check block for v4 results', () => {
            const wrapper = mount(OCRRawTextPanel, { props: { text: 'x' }, global: { plugins: [i18n] } })
            expect(wrapper.find('[data-testid="raw-text-output-checks"]').exists()).toBe(false)
        })
    })
})
