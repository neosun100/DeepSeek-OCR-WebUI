import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import OCRQueuePopover from '@/components/common/OCRQueuePopover.vue'
import { createTestingPinia } from '@pinia/testing'
import { useHealthStore } from '@/stores/health'
import { usePagesStore } from '@/stores/pages'
import { i18n } from '@/i18n'
import { NCheckbox } from 'naive-ui'

// Monkey-patch CSSStyleDeclaration to prevent JSDOM crash on Naive UI styles
if (typeof CSSStyleDeclaration !== 'undefined') {
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (property: string, value: string | null, priority?: string) {
        if (property === 'border' || property.startsWith('border-')) {
            if (typeof value === 'string' && value.includes('var(')) {
                return;
            }
        }
        return originalSetProperty.call(this, property, value, priority);
    };
}

vi.mock('naive-ui', async (importOriginal) => {
    const mod = await importOriginal<any>()
    return {
        ...mod,
        createDiscreteApi: vi.fn(() => ({
            message: {
                success: vi.fn(),
                info: vi.fn(),
                error: vi.fn()
            }
        }))
    }
})

// Type for exposed VM
interface PopoverVM {
    selectedIds: Set<string>;
    allTaskIds: string[];
    isAllSelected: boolean;
    isPartiallySelected: boolean;
    handleStopAll: () => Promise<void>;
    handleStopSelected: () => Promise<void>;
    handleStopSingle: (id: string) => Promise<void>;
    handleSelectAll: (checked: boolean) => void;
    handleItemSelect: (id: string, checked: boolean) => void;
    $nextTick: () => Promise<void>;
}

describe('OCRQueuePopover', () => {
    let pinia: any

    const activeTask = { id: 'p1', fileName: 'active.png', status: 'recognizing', updatedAt: new Date(), progress: 0 }
    const queuedTask = { id: 'p2', fileName: 'queued.png', status: 'pending_ocr', updatedAt: new Date(), progress: 0 }

    beforeEach(() => {
        // Mock environment issues
        if (typeof (global as any).ResizeObserver === 'undefined') {
            (global as any).ResizeObserver = vi.fn().mockImplementation(() => ({
                observe: vi.fn(),
                unobserve: vi.fn(),
                disconnect: vi.fn(),
            }));
        }

        pinia = createTestingPinia({
            createSpy: vi.fn,
            stubActions: false
        })
    })

    const mountComponent = () => {
        return mount(OCRQueuePopover, {
            global: {
                plugins: [pinia, i18n],
                stubs: {
                    NIcon: { template: '<i><slot /></i>' },
                    NBadge: { template: '<span><slot /></span>' },
                    NScrollbar: { template: '<div><slot /></div>' },
                    NEmpty: { template: '<div><slot /></div>' },
                    NSpin: { template: '<div><slot /></div>' }
                    // NCheckbox and NButton are NOT stubbed
                }
            }
        })
    }

    it('renders task lists and exhaustively covers all methods and branches', async () => {
        const s = usePagesStore(pinia)
        const cancelSpy = vi.fn()
        s.cancelOCRTasks = cancelSpy

        // @ts-expect-error - testing-pinia stubs
        s.pages = [activeTask, queuedTask]
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.queuedOCRTasks = [queuedTask]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 2

        const wrapper = mountComponent()
        const vm = wrapper.vm as unknown as PopoverVM
        await vm.$nextTick()

        expect(wrapper.text()).toContain('OCR Queue')
        expect(wrapper.text()).toContain('active.png')
        expect(wrapper.text()).toContain('queued.png')

        // Find real Naive UI components
        const checkboxes = wrapper.findAll('.n-checkbox')
        expect(checkboxes.length).toBe(3)

        await vm.handleItemSelect('p1', true)
        await vm.handleItemSelect('p2', true)
        expect(vm.selectedIds.has('p1')).toBe(true)

        await vm.handleSelectAll(true)
        expect(vm.isAllSelected).toBe(true)
        await vm.handleSelectAll(false)
        expect(vm.selectedIds.size).toBe(0)

        const stopBtns = wrapper.findAll('.task-item button')
        if (stopBtns[0]) await stopBtns[0].trigger('click')
        expect(cancelSpy).toHaveBeenCalled()

        await vm.handleStopSelected()
        await vm.handleStopAll()
    })

    it('handles checkbox selection logic', async () => {
        const s = usePagesStore(pinia)
        const p3 = { id: 'p3', fileName: 'test3.png', status: 'recognizing', updatedAt: new Date(), progress: 0 }
        // @ts-expect-error - testing-pinia stubs
        s.pages = [activeTask, p3]
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [activeTask, p3]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 2

        const wrapper = mountComponent()
        const vm = wrapper.vm as unknown as PopoverVM
        await vm.$nextTick()

        await vm.handleItemSelect('p1', true)
        expect(vm.isPartiallySelected).toBe(true)

        // Test unchecking (covers else branch of handleItemSelect)
        await vm.handleItemSelect('p1', false)
        expect(vm.selectedIds.has('p1')).toBe(false)
        expect(vm.isPartiallySelected).toBe(false)
    })

    it('handles queued task interactions and hover states', async () => {
        const s = usePagesStore(pinia)
        const queuedId = 'p2'
        const cancelSpy = vi.fn()
        s.cancelOCRTasks = cancelSpy

        // @ts-expect-error - testing-pinia stubs
        s.pages = [activeTask, queuedTask]
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.queuedOCRTasks = [queuedTask]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 2

        const wrapper = mountComponent()
        const vm = wrapper.vm as unknown as PopoverVM
        await vm.$nextTick()

        // Find queued tasks section
        const queuedItems = wrapper.findAll('.task-item.queued')
        expect(queuedItems.length).toBe(1)
        const queuedItem = queuedItems[0]

        // Test checkbox interaction
        const queuedCheckbox = queuedItem!.findComponent(NCheckbox)
        queuedCheckbox.vm.$emit('update:checked', true)
        expect(vm.selectedIds.has(queuedId)).toBe(true)

        // Test cancel button hover and click
        const queuedCancelBtn = queuedItem!.find('button.cancel-btn')
        expect(queuedCancelBtn.exists()).toBe(true)

        // Trigger hover events to cover mouseenter/mouseleave
        await queuedCancelBtn.trigger('mouseenter')
        await queuedCancelBtn.trigger('mouseleave')

        await queuedCancelBtn.trigger('click')
        expect(cancelSpy).toHaveBeenCalledWith([queuedId])

        // Test active task button hover (toolbar button)
        const batchBtn = wrapper.find('.list-toolbar .action-btn')
        if (batchBtn.exists()) {
            await batchBtn.trigger('mouseenter')
            await batchBtn.trigger('mouseleave')
        }
    })

    it('cancels selected tasks and clears selection', async () => {
        const s = usePagesStore(pinia)
        const cancelSpy = vi.fn()
        s.cancelOCRTasks = cancelSpy
        // @ts-expect-error - testing-pinia stubs
        s.pages = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 1

        const wrapper = mountComponent()
        const vm = wrapper.vm as unknown as PopoverVM
        await vm.$nextTick()

        await vm.handleItemSelect('p1', true)
        await vm.$nextTick()

        const cancelSelectedBtn = wrapper.find('.list-toolbar button.action-btn')
        expect(cancelSelectedBtn.exists()).toBe(true)
        await cancelSelectedBtn.trigger('click')
        expect(cancelSpy).toHaveBeenCalledWith(['p1'])
    })

    it('cancels all tasks via expose method', async () => {
        const s = usePagesStore(pinia)
        s.cancelOCRTasks = vi.fn()
        // @ts-expect-error - testing-pinia stubs
        s.pages = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 1

        const wrapper = mountComponent()
        const vm = wrapper.vm as unknown as PopoverVM
        await vm.$nextTick()

        await vm.handleStopAll()


        expect((s.cancelOCRTasks as Mock).mock.calls[0]![0]).toContain('p1')
    })

    it('closes on footer button click', async () => {
        const wrapper = mountComponent()
        await wrapper.vm.$nextTick()
        const closeBtn = wrapper.find('.queue-footer button.footer-close-btn')
        expect(closeBtn.exists()).toBe(true)
        await closeBtn.trigger('click')
        expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('renders empty state when no tasks', async () => {
        const s = usePagesStore(pinia)
        s.pages = []
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = []
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 0

        const wrapper = mountComponent()
        await wrapper.vm.$nextTick()
        expect(wrapper.text()).toContain('No active OCR tasks')
    })

    it('updates selection when tasks are removed from store (watch logic)', async () => {
        const s = usePagesStore(pinia)
        const p1 = { id: 'p1', fileName: '1.png', status: 'recognizing', updatedAt: new Date(), progress: 0 }
        const p2 = { id: 'p2', fileName: '2.png', status: 'recognizing', updatedAt: new Date(), progress: 0 }
        // @ts-expect-error - testing-pinia stubs
        s.pages = [p1, p2]
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [p1, p2]
        // @ts-expect-error - testing-pinia stubs
        s.queuedOCRTasks = []
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 2

        const wrapper = mountComponent()
        const vm = wrapper.vm as unknown as PopoverVM
        await vm.$nextTick()

        // Select both
        await vm.handleSelectAll(true)
        expect(vm.selectedIds.size).toBe(2)

        // Remove p1 from store
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [p2]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 1

        await vm.$nextTick()
        expect(vm.selectedIds.has('p1')).toBe(false)
        expect(vm.selectedIds.has('p2')).toBe(true)
    })

    it('handles hover states for buttons', async () => {
        const s = usePagesStore(pinia)
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 1

        const wrapper = mountComponent()
        const vm = wrapper.vm as unknown as PopoverVM
        await vm.$nextTick()

        // 1. Hover Batch Cancel Button
        // First, ensure it exists by selecting sth
        await vm.handleItemSelect('p1', true)
        await vm.$nextTick()

        const batchBtn = wrapper.find('.list-toolbar .action-btn')
        expect(batchBtn.exists()).toBe(true)
        await batchBtn.trigger('mouseenter')
        // @ts-expect-error - private access
        expect(vm.hoveredBtnId).toBe('batch')
        await batchBtn.trigger('mouseleave')
        // @ts-expect-error - private access
        expect(vm.hoveredBtnId).toBe(null)

        // 2. Hover Task Cancel Button
        const taskBtn = wrapper.find('.task-item .cancel-btn')
        expect(taskBtn.exists()).toBe(true)
        await taskBtn.trigger('mouseenter')
        // @ts-expect-error - private access
        expect(vm.hoveredBtnId).toBe('p1')
        await taskBtn.trigger('mouseleave')
        // @ts-expect-error - private access
        expect(vm.hoveredBtnId).toBe(null)
    })

    it('handles active task checkbox update trigger', async () => {
        const s = usePagesStore(pinia)
        // @ts-expect-error - testing-pinia stubs
        s.activeOCRTasks = [activeTask]
        // @ts-expect-error - testing-pinia stubs
        s.ocrTaskCount = 1

        const wrapper = mountComponent()
        await wrapper.vm.$nextTick()

        const checkbox = wrapper.find('.task-item.processing').findComponent(NCheckbox)
        expect(checkbox.exists()).toBe(true)

        // Directly trigger update event bound in template
        await checkbox.vm.$emit('update:checked', true)

        const vm = wrapper.vm as unknown as PopoverVM
        expect(vm.selectedIds.has('p1')).toBe(true)
    })

    it('shows model-loading banner and engine summary from v5 health', async () => {
        const h = useHealthStore(pinia)
        h.serviceState = 'starting'
        h.healthInfo = {
            status: 'starting', version: '5.0.0', backend: 'cuda', model_loaded: false,
            engine: { engine: 'hf', device: 'cuda', dtype: 'bfloat16' }
        } as any
        const wrapper = mountComponent()
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="ocr-queue-model-loading"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="ocr-queue-engine"]').text()).toBe('hf · cuda · bfloat16 · v5.0.0')
    })

    it('shows model error banner with load_error', async () => {
        const h = useHealthStore(pinia)
        h.serviceState = 'error'
        h.healthInfo = { status: 'error', load_error: 'weights missing', backend: null, model_loaded: false } as any
        const wrapper = mountComponent()
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="ocr-queue-model-error"]').text()).toContain('weights missing')
    })
})
