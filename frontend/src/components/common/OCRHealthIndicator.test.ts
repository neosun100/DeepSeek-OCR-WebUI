import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import OCRHealthIndicator from './OCRHealthIndicator.vue'
import { useHealthStore } from '@/stores/health'
import { NBadge, NButton, NIcon, NTooltip } from 'naive-ui'

// Mock translations
vi.mock('vue-i18n', () => ({
    useI18n: () => ({
        t: (key: string) => key
    })
}))

describe('OCRHealthIndicator', () => {
    const globalMountOptions = {
        global: {
            mocks: {
                $t: (key: string) => key
            },
            plugins: [
                createTestingPinia({
                    createSpy: vi.fn,
                })
            ],
            components: {
                NBadge, NButton, NIcon, NTooltip
            },
            stubs: {
                NTooltip: {
                    template: '<div><slot name="trigger"></slot><div class="n-tooltip"><slot></slot></div></div>'
                },
                NBadge: {
                    template: '<div><slot></slot></div>',
                    props: ['color', 'processing']
                },
                NButton: {
                    template: '<button class="n-button"><slot></slot><slot name="icon"></slot></button>',
                    props: ['type', 'size']
                },
                NIcon: {
                    template: '<i class="n-icon"><slot></slot></i>',
                    props: ['component']
                }
            }
        }
    }

    it('should display healthy state', async () => {
        const wrapper = mount(OCRHealthIndicator, globalMountOptions)
        const store = useHealthStore()

        // Mock healthy state
        store.isHealthy = true
        store.healthInfo = {
            status: 'healthy',
            backend: 'cuda',
            platform: 'linux',
            model_loaded: true
        } as any

        await wrapper.vm.$nextTick()

        // Check tooltip status text
        expect(wrapper.find('.health-status').text()).toContain('health.healthy')
    })

    it('should display busy state', async () => {
        const wrapper = mount(OCRHealthIndicator, globalMountOptions)
        const store = useHealthStore()

        store.isHealthy = true
        store.healthInfo = {
            status: 'busy',
        } as any

        await wrapper.vm.$nextTick()

        expect(wrapper.find('.health-status').text()).toContain('health.busy')
        expect(wrapper.text()).toContain('health.busyTooltip')
    })

    it('should display full state', async () => {
        const wrapper = mount(OCRHealthIndicator, globalMountOptions)
        const store = useHealthStore()

        store.isHealthy = true
        store.healthInfo = {
            status: 'full',
        } as any

        await wrapper.vm.$nextTick()

        expect(wrapper.find('.health-status').text()).toContain('health.full')
        expect(wrapper.text()).toContain('health.fullTooltip')
    })

    it('should display unavailable state', async () => {
        const wrapper = mount(OCRHealthIndicator, globalMountOptions)
        const store = useHealthStore()

        store.isHealthy = false
        store.healthInfo = null

        await wrapper.vm.$nextTick()

        expect(wrapper.find('.health-status').text()).toContain('health.unavailable')
    })

    it('should render in compact mode', async () => {
        const wrapper = mount(OCRHealthIndicator, {
            ...globalMountOptions,
            props: { compact: true }
        })

        await wrapper.vm.$nextTick()

        // In compact mode, text should not be visible
        expect(wrapper.find('.health-indicator-btn.is-compact').exists()).toBe(true)
    })

    it('should display queue information when available', async () => {
        const wrapper = mount(OCRHealthIndicator, globalMountOptions)
        const store = useHealthStore()

        store.healthInfo = {
            status: 'busy',
            backend: 'cuda',
            platform: 'linux',
            model_loaded: true,
            ocr_queue: {
                depth: 5,
                max_size: 10,
                is_full: false
            }
        } as any

        await wrapper.vm.$nextTick()

        expect(wrapper.text()).toContain('5 / 10')
    })

    it('should format time correctly', async () => {
        const wrapper = mount(OCRHealthIndicator, globalMountOptions)
        const vm = wrapper.vm as any

        // Test "just now" (< 10s)
        const now = new Date()
        expect(vm.formatTime(now)).toBe('health.justNow')

        // Test "ago" (< 60s)
        const ago30s = new Date(now.getTime() - 30000)
        expect(vm.formatTime(ago30s)).toBe('health.ago')

        // Test "minutes ago" (< 1 hour)
        const ago5min = new Date(now.getTime() - 300000)
        expect(vm.formatTime(ago5min)).toBe('health.minutesAgo')
    })

    describe('v5 states', () => {
        it('shows model loading (starting) as a warning state, not unavailable', async () => {
            const wrapper = mount(OCRHealthIndicator, globalMountOptions)
            const store = useHealthStore()
            store.isHealthy = true
            store.serviceState = 'starting'
            store.healthInfo = { status: 'starting', ready: false, backend: 'cuda', model_loaded: false } as any
            await wrapper.vm.$nextTick()

            expect(wrapper.find('.health-status').text()).toContain('health.starting')
            expect(wrapper.find('[data-testid="health-starting-hint"]').exists()).toBe(true)
            expect(wrapper.findComponent(NButton).props('type')).toBe('warning')
        })

        it('shows load_error when the model failed to load', async () => {
            const wrapper = mount(OCRHealthIndicator, globalMountOptions)
            const store = useHealthStore()
            store.isHealthy = false
            store.serviceState = 'error'
            store.healthInfo = { status: 'error', load_error: 'weights missing', backend: null } as any
            await wrapper.vm.$nextTick()

            expect(wrapper.find('.health-status').text()).toContain('health.modelError')
            expect(wrapper.find('[data-testid="health-load-error"]').exists()).toBe(true)
            expect(wrapper.findComponent(NButton).props('type')).toBe('error')
        })

        it('shows engine device, dtype and version', async () => {
            const wrapper = mount(OCRHealthIndicator, globalMountOptions)
            const store = useHealthStore()
            store.isHealthy = true
            store.serviceState = 'ready'
            store.healthInfo = {
                status: 'healthy', version: '5.0.0', model_version: 'DeepSeek-OCR-2', backend: 'cuda',
                engine: { engine: 'vllm', device: 'cuda', dtype: 'bfloat16' }, model_loaded: true
            } as any
            await wrapper.vm.$nextTick()

            const text = wrapper.find('[data-testid="health-tooltip"]').text()
            expect(text).toContain('5.0.0')
            expect(text).toContain('DeepSeek-OCR-2')
            expect(text).toContain('vllm')
            expect(wrapper.find('[data-testid="health-device"]').text()).toContain('cuda')
            expect(wrapper.find('[data-testid="health-device"]').text()).toContain('bfloat16')
        })
    })
})
