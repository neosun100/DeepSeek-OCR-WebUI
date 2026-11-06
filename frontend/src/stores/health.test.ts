import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useHealthStore } from './health'

// Mock dependencies
const { mockHealthService } = vi.hoisted(() => {
    return {
        mockHealthService: {
            start: vi.fn(),
            stop: vi.fn(),
            getStatus: vi.fn().mockReturnValue(true),
            getServiceState: vi.fn().mockReturnValue('ready'),
            checkNow: vi.fn().mockResolvedValue(undefined),
            getHealthInfo: vi.fn().mockReturnValue({ status: 'healthy' }),
            getLastCheckTime: vi.fn().mockReturnValue(new Date())
        }
    }
})

vi.mock('@/services/health', () => {
    return {
        HealthCheckService: class {
            constructor() {
                return mockHealthService
            }
        }
    }
})

vi.mock('@/config', () => ({
    config: {
        apiBaseUrl: 'https://mock-api'
    }
}))

describe('Health Store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('should initialize with default state', () => {
        const store = useHealthStore()
        expect(store.isHealthy).toBe(true)
        expect(store.healthInfo).toBeNull()
        expect(store.lastCheckTime).toBeNull()
        expect(store.error).toBeNull()
    })

    it('should start health check service', () => {
        const store = useHealthStore()
        store.startHealthCheck()

        expect(mockHealthService.start).toHaveBeenCalled()
    })

    it('should update status periodically', () => {
        const store = useHealthStore()
        store.startHealthCheck()

        // Initial update
        expect(store.isHealthy).toBe(true)
        expect(store.healthInfo).toEqual({ status: 'healthy' })

        // Change mock implementation
        mockHealthService.getStatus.mockReturnValue(false)

        // Fast forward time
        vi.advanceTimersByTime(1000)

        expect(store.isHealthy).toBe(false)
    })

    it('should stop health check service', () => {
        const store = useHealthStore()
        store.startHealthCheck()
        store.stopHealthCheck()

        expect(mockHealthService.stop).toHaveBeenCalled()
    })

    it('should expose computed properties for queue status', () => {
        const store = useHealthStore()
        store.startHealthCheck()

        // Mock complex health info
        const mockInfo = {
            status: 'busy',
            ocr_queue: { depth: 5, max_size: 10, is_full: false },
            rate_limits: { max_per_client: 2 },
            your_queue_status: { client_id: '123', position: 3, total_queued: 5 }
        }
        mockHealthService.getHealthInfo.mockReturnValue(mockInfo)

        // Trigger update
        store.updateStatus()

        // These properties don't exist yet, so this test should compile but fail logic (if ts-ignore) or fail type check
        // In JS/TS usage for TDD, we expect these to be undefined or throw
        expect(store.isBusy).toBe(true)
        expect(store.isFull).toBe(false)
        expect(store.queueStatus).toEqual(mockInfo.ocr_queue)
        expect(store.rateLimits).toEqual(mockInfo.rate_limits)
        expect(store.yourQueueStatus).toEqual(mockInfo.your_queue_status)
        expect(store.queuePosition).toBe(3)
    })

    it('should handle isFull computed property correctly', () => {
        const store = useHealthStore()
        store.startHealthCheck()

        // Mock full state
        mockHealthService.getHealthInfo.mockReturnValue({
            status: 'full',
            backend: 'test',
            platform: 'test',
            model_loaded: true
        })
        store.updateStatus()

        expect(store.isFull).toBe(true)
        expect(store.isBusy).toBe(false)
    })

    it('should handle isProcessing and isQueued computed properties', () => {
        const store = useHealthStore()
        store.startHealthCheck()

        // Mock processing (position = 1)
        mockHealthService.getHealthInfo.mockReturnValue({
            status: 'busy',
            your_queue_status: { client_id: '123', position: 1, total_queued: 3 }
        })
        store.updateStatus()

        expect(store.isProcessing).toBe(true)
        expect(store.isQueued).toBe(false)

        // Mock queued (position > 1)
        mockHealthService.getHealthInfo.mockReturnValue({
            status: 'busy',
            your_queue_status: { client_id: '123', position: 2, total_queued: 3 }
        })
        store.updateStatus()

        expect(store.isProcessing).toBe(false)
        expect(store.isQueued).toBe(true)
    })

    it('should handle null queue position', () => {
        const store = useHealthStore()
        store.startHealthCheck()

        // Mock no queue position
        mockHealthService.getHealthInfo.mockReturnValue({
            status: 'healthy',
            your_queue_status: { client_id: '123', position: null, total_queued: 0 }
        })
        store.updateStatus()

        expect(store.queuePosition).toBeNull()
        expect(store.isProcessing).toBe(false)
        expect(store.isQueued).toBe(false)
    })

    it('should not create duplicate service or interval when starting multiple times', () => {
        const store = useHealthStore()

        // Start first time
        store.startHealthCheck()
        expect(mockHealthService.start).toHaveBeenCalledTimes(1)

        // Start again - should not create new service, but will call start again
        store.startHealthCheck()
        expect(mockHealthService.start).toHaveBeenCalledTimes(2)
    })

    it('should handle stop when service is null', () => {
        const store = useHealthStore()

        // Stop without starting
        expect(() => store.stopHealthCheck()).not.toThrow()
        expect(mockHealthService.stop).not.toHaveBeenCalled()
    })

    it('should handle updateStatus when service is null', () => {
        const store = useHealthStore()

        // Update without starting
        expect(() => store.updateStatus()).not.toThrow()
        expect(store.isHealthy).toBe(true) // Should remain default
    })

    it('should handle computed properties when healthInfo is null', () => {
        const store = useHealthStore()

        expect(store.queueStatus).toBeUndefined()
        expect(store.rateLimits).toBeUndefined()
        expect(store.yourQueueStatus).toBeUndefined()
        expect(store.isBusy).toBe(false)
        expect(store.isFull).toBe(false)
        expect(store.queuePosition).toBeNull()
    })

    describe('v5 service states', () => {
        it('exposes starting state as healthy-but-not-ready (tasks may queue)', () => {
            mockHealthService.getStatus.mockReturnValue(true)
            mockHealthService.getServiceState.mockReturnValue('starting')
            mockHealthService.getHealthInfo.mockReturnValue({ status: 'starting', ready: false, version: '5.0.0' })
            const store = useHealthStore()
            store.startHealthCheck()
            expect(store.isHealthy).toBe(true)
            expect(store.isReady).toBe(false)
            expect(store.isStarting).toBe(true)
            expect(store.serverVersion).toBe('5.0.0')
        })

        it('exposes model load error with load_error and engine info', () => {
            mockHealthService.getStatus.mockReturnValue(false)
            mockHealthService.getServiceState.mockReturnValue('error')
            mockHealthService.getHealthInfo.mockReturnValue({
                status: 'error', load_error: 'CUDA OOM', engine: { engine: 'hf', device: 'cuda', dtype: 'bfloat16' }
            })
            const store = useHealthStore()
            store.startHealthCheck()
            expect(store.isHealthy).toBe(false)
            expect(store.isModelError).toBe(true)
            expect(store.loadError).toBe('CUDA OOM')
            expect(store.engineInfo?.device).toBe('cuda')
        })

        it('checkNow runs an immediate check and refreshes state', async () => {
            mockHealthService.getServiceState.mockReturnValue('unavailable')
            mockHealthService.getStatus.mockReturnValue(false)
            const store = useHealthStore()
            store.startHealthCheck()
            await store.checkNow()
            expect(mockHealthService.checkNow).toHaveBeenCalled()
            expect(store.isUnreachable).toBe(true)
        })
    })
})
