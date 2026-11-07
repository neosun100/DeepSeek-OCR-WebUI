import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NButton } from 'naive-ui'
import { createTestingPinia } from '@pinia/testing'
import PageItem from './PageItem.vue'
import type { Page } from '@/stores/pages'
import { usePagesStore } from '@/stores/pages'
import { useHealthStore } from '@/stores/health'
import { ocrService } from '@/services/ocr'
import { db } from '@/db'
import { i18n } from '@/i18n'

// Mock dependencies
vi.mock('@/services/ocr', () => ({
    ocrService: {
        processImage: vi.fn(),
        queueOCR: vi.fn()
    }
}))

vi.mock('@/db', () => ({
    db: {
        getPageImage: vi.fn(),
        getPageOCRSummary: vi.fn().mockResolvedValue(undefined)
    }
}))

// Mock Naive UI components to simplify testing
// Hoist mocks for spying
const mocks = vi.hoisted(() => ({
    dialog: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
        create: vi.fn()
    },
    message: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn()
    },
    notification: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn()
    }
}))

// Mock Naive UI components to simplify testing
vi.mock('naive-ui', () => ({
    NButton: {
        name: 'NButton',
        props: ['loading', 'disabled'],
        template: '<button :disabled="disabled || loading"><slot name="icon"></slot><slot></slot></button>'
    },
    NTag: {
        name: 'NTag',
        props: ['type', 'size'],
        template: '<span><slot></slot></span>'
    },
    NCheckbox: {
        name: 'NCheckbox',
        props: ['checked', 'size'],
        template: '<div><input type="checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked)" /></div>'
    },
    NSpin: {
        name: 'NSpin',
        template: '<div>Spinning...</div>'
    },
    NIcon: {
        name: 'NIcon',
        props: ['size', 'color'],
        template: '<span><slot></slot></span>'
    },
    NTooltip: {
        name: 'NTooltip',
        template: '<span><slot name="trigger"></slot><span class="tooltip-body"><slot></slot></span></span>'
    },
    useMessage: () => mocks.message,
    useNotification: () => mocks.notification,
    useDialog: () => mocks.dialog
}))

describe('PageItem.vue', () => {
    let mockPage: Page
    let pinia: ReturnType<typeof import("pinia").createPinia>

    beforeEach(() => {
        vi.clearAllMocks()

        mockPage = {
            id: 'page-1',
            fileName: 'test-file.pdf',
            fileSize: 1024 * 1024, // 1MB
            fileType: 'application/pdf',
            origin: 'upload',
            status: 'ready',
            progress: 100,
            order: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            outputs: [],
            logs: [],
            thumbnailData: 'data:image/png;base64,mock'
        }

        pinia = createTestingPinia({
            createSpy: vi.fn,
            initialState: {
                pages: {
                    selectedPageIds: []
                }
            }
        })
    })

    it('renders file name and formatted size correctly', () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: {
                plugins: [pinia, i18n]
            }
        })

        expect(wrapper.find('.page-name').text()).toBe('test-file.pdf')
        expect(wrapper.find('.page-info').text()).toBeTruthy()
    })

    it('renders thumbnail when thumbnailData is present', () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: {
                plugins: [pinia, i18n]
            }
        })

        expect(wrapper.find('.thumbnail-img').exists()).toBe(true)
        expect(wrapper.find('.thumbnail-img').attributes('src')).toBe(mockPage.thumbnailData)
    })

    it('emits click event when clicked', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: {
                plugins: [pinia, i18n]
            }
        })

        await wrapper.find('.page-item').trigger('click')
        expect(wrapper.emitted('click')).toBeTruthy()
        expect(wrapper.emitted('click')![0]).toEqual([mockPage])
    })

    it('emits delete event when delete button is clicked', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: {
                plugins: [pinia, i18n]
            }
        })

        const deleteBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Delete page')
        expect(deleteBtn).toBeTruthy()
        await deleteBtn!.trigger('click')

        expect(wrapper.emitted('delete')).toBeTruthy()
        expect(wrapper.emitted('delete')![0]).toEqual([mockPage])
    })

    it('handles Scan button click', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: {
                plugins: [pinia, i18n]
            }
        })

        // Mock DB and OCR success
        const mockBlob = new Blob(['img'], { type: 'image/jpeg' })
        vi.mocked(db.getPageImage).mockResolvedValue(mockBlob)
        vi.mocked(ocrService.queueOCR).mockResolvedValue()

        const scanBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Scan to Document')
        expect(scanBtn).toBeTruthy()

        await scanBtn!.trigger('click')
        await flushPromises()

        expect(db.getPageImage).toHaveBeenCalledWith(mockPage.id)

        expect(ocrService.queueOCR).toHaveBeenCalledWith(mockPage.id, mockBlob)
    })
    it('handles Scan button error with unknown error', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: { plugins: [pinia, i18n] }
        })

        vi.mocked(db.getPageImage).mockRejectedValue('Unknown error')
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

        const scanBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Scan to Document')
        await scanBtn!.trigger('click')
        await flushPromises()

        expect(consoleSpy).toHaveBeenCalled()
        consoleSpy.mockRestore()
    })

    it('handles Scan button error with queue full', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: { plugins: [pinia, i18n] }
        })

        const healthStore = useHealthStore()
        healthStore.healthInfo = { status: 'full' } as any

        vi.mocked(db.getPageImage).mockResolvedValue(new Blob(['img'], { type: 'image/jpeg' }))

        const scanBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Scan to Document')
        await scanBtn!.trigger('click')
        await flushPromises()

        expect(mocks.dialog.error).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Queue Full',
            content: 'OCR queue is full. Please try again later.', // using EN key value for test
        }))
        expect(ocrService.queueOCR).not.toHaveBeenCalled()
    })

    it('handles checkbox change', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: { plugins: [pinia, i18n] }
        })
        const store = usePagesStore()

        await wrapper.findComponent({ name: 'NCheckbox' }).vm.$emit('update:checked', true)
        expect(store.togglePageSelection).toHaveBeenCalledWith(mockPage.id)
    })

    it('computes isScanning correctly', async () => {
        const scanningPage = { ...mockPage, status: 'recognizing' as const }
        const wrapper = mount(PageItem, {
            props: { page: scanningPage },
            global: { plugins: [pinia, i18n] }
        })

        const scanBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Scan to Document')
        expect(scanBtn?.attributes('disabled')).toBeDefined()
    })

    it('formats file size correctly', () => {
        const wrapper = mount(PageItem, {
            props: { page: { ...mockPage, fileSize: 0 } },
            global: { plugins: [pinia, i18n] }
        })
        expect(wrapper.find('.page-info').text()).toBe('0 B')

        const wrapper2 = mount(PageItem, {
            props: { page: { ...mockPage, fileSize: 1024 } },
            global: { plugins: [pinia, i18n] }
        })
        expect(wrapper2.find('.page-info').text()).toBe('1.0 KB')
    })

    it('returns correct status text and type', () => {
        const statuses = [
            { status: 'pending_render', text: 'Queued', type: 'warning' },
            { status: 'rendering', text: 'Rendering', type: 'info' },
            { status: 'pending_ocr', text: 'Queued', type: 'info' },
            { status: 'recognizing', text: 'Scanning', type: 'info' },
            { status: 'ocr_success', text: 'OCR Done', type: 'success' },
            { status: 'error', text: 'Error', type: 'error' },
            { status: 'completed', text: '', type: 'success' },
            { status: 'ready', text: '', type: 'default' },
        ] as const

        statuses.forEach(({ status, text, type }) => {
            const wrapper = mount(PageItem, {
                props: { page: { ...mockPage, status, thumbnailData: undefined } },
                global: { plugins: [pinia, i18n] }
            })

            if (text) {
                expect(wrapper.find('.status-label').text()).toBe(text)
            }
            if (type === 'success' || type === 'info' || type === 'error' || type === 'warning') {
                // NTag type check if tag exists
                const tag = wrapper.findComponent({ name: 'NTag' })
                if (tag.exists()) {
                    expect(tag.props('type')).toBe(type) // Actually OCR tag is fixed in template?
                }
            }
        })
    })

    it('applies dragging class', () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage, isDragging: true },
            global: { plugins: [pinia, i18n] }
        })
        expect(wrapper.classes()).toContain('dragging')
    })

    it('handles image load failure (no blob)', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: { plugins: [pinia, i18n] }
        })

        vi.mocked(db.getPageImage).mockResolvedValue(undefined)

        const scanBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Scan to Document')
        await scanBtn!.trigger('click')
        await flushPromises()

        expect(ocrService.queueOCR).not.toHaveBeenCalled()
    })

    it('updates hover states', async () => {
        const wrapper = mount(PageItem, {
            props: { page: mockPage },
            global: { plugins: [pinia, i18n] }
        })

        await wrapper.trigger('mouseenter')
        expect((wrapper.vm as any).isPageHovered).toBe(true)

        await wrapper.trigger('mouseleave')
        expect((wrapper.vm as any).isPageHovered).toBe(false)

        const deleteBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Delete page')
        await deleteBtn?.trigger('mouseenter')
        expect((wrapper.vm as any).isDeleteHovered).toBe(true)

        await deleteBtn?.trigger('mouseleave')
        expect((wrapper.vm as any).isDeleteHovered).toBe(false)

        const scanBtn = wrapper.findAllComponents(NButton).find(c => c.attributes('title') === 'Scan to Document')
        await scanBtn?.trigger('mouseenter')
        expect((wrapper.vm as any).isScanHovered).toBe(true)

        await scanBtn?.trigger('mouseleave')
        expect((wrapper.vm as any).isScanHovered).toBe(false)
    })

    describe('OCR output warnings (v5)', () => {
        const mountWith = (status: Page['status']) => mount(PageItem, {
            props: { page: { ...mockPage, status } },
            global: { plugins: [pinia, i18n] }
        })

        it('shows a warning badge with messages for failing warnings', async () => {
            vi.mocked(db.getPageOCRSummary).mockResolvedValue({
                warnings: [
                    { code: 'repetition_cut', message: 'tail repetition cut' },
                    { code: 'near_empty', message: 'few chars' }
                ],
                finishReason: 'repetition_cut',
                ok: false
            })
            const wrapper = mountWith('completed')
            await flushPromises()
            expect(wrapper.find('[data-testid="page-output-warning"]').exists()).toBe(true)
            const items = wrapper.findAll('[data-testid="page-output-warning-item"]').map(w => w.text())
            expect(items).toEqual(['tail repetition cut'])
        })

        it('shows no badge for informational warnings only', async () => {
            vi.mocked(db.getPageOCRSummary).mockResolvedValue({
                warnings: [{ code: 'near_empty', message: 'few chars' }, { code: 'bbox_invalid', message: 'bad box' }],
                finishReason: 'stop',
                ok: true
            })
            const wrapper = mountWith('ocr_success')
            await flushPromises()
            expect(wrapper.find('[data-testid="page-output-warning"]').exists()).toBe(false)
        })

        it('does not query OCR data before OCR finished', async () => {
            mountWith('pending_ocr')
            await flushPromises()
            expect(db.getPageOCRSummary).not.toHaveBeenCalled()
        })
    })
})
