import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HealthCheckService } from './index'
import type { HealthResponse } from './types'

describe('HealthCheckService', () => {
    let service: HealthCheckService
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.useFakeTimers()
        fetchMock = vi.fn()
        global.fetch = fetchMock as any
        service = new HealthCheckService('https://mock-api')
    })

    afterEach(() => {
        service.stop()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    describe('start and stop', () => {
        it('should start health check and make initial call', async () => {
            expect.hasAssertions()

            const healthResponse: HealthResponse = {
                status: 'healthy',
                backend: 'cuda',
                platform: 'Linux',
                model_loaded: true
            }

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => healthResponse
            })

            service.start()

            // Wait for initial call to complete
            await vi.advanceTimersByTimeAsync(0)

            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(fetchMock).toHaveBeenCalledWith(
                'https://mock-api/health',
                expect.objectContaining({
                    signal: expect.any(AbortSignal)
                })
            )
            expect(service.getStatus()).toBe(true)
            expect(service.getHealthInfo()).toEqual(healthResponse)
        })

        it('should stop health check and clear interval', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ status: 'healthy', backend: 'cuda', platform: 'Linux', model_loaded: true })
            })

            service.start()
            await vi.advanceTimersByTimeAsync(0)

            const callCountBeforeStop = fetchMock.mock.calls.length

            service.stop()

            // Advance time and verify no more calls
            await vi.advanceTimersByTimeAsync(10000)

            expect(fetchMock).toHaveBeenCalledTimes(callCountBeforeStop)
        })

        it('should handle multiple start calls without creating duplicate intervals', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ status: 'healthy', backend: 'cuda', platform: 'Linux', model_loaded: true })
            })

            service.start()
            service.start()
            service.start()

            await vi.advanceTimersByTimeAsync(0)

            // Should only have one initial call
            expect(fetchMock).toHaveBeenCalledTimes(1)
        })
    })

    describe('health check polling', () => {
        it('should make request to correct url', async () => {
            expect.hasAssertions()
            const testService = new HealthCheckService('https://mock-api')
            const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'healthy' })))

            testService.start()
            await vi.advanceTimersByTimeAsync(0)

            expect(fetchSpy).toHaveBeenCalledWith(
                'https://mock-api/health',
                expect.objectContaining({
                    signal: expect.any(AbortSignal)
                })
            )
            fetchSpy.mockRestore()
            testService.stop()
        })

        it('should poll every 5 seconds', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ status: 'healthy', backend: 'cuda', platform: 'Linux', model_loaded: true })
            })

            service.start()

            // Initial call - need to wait for the async pollLoop to start
            await vi.advanceTimersByTimeAsync(0)
            expect(fetchMock).toHaveBeenCalledTimes(1)

            // After 5 seconds, the second call should happen
            // (5 seconds after first call completes)
            await vi.advanceTimersByTimeAsync(5000)
            expect(fetchMock).toHaveBeenCalledTimes(2)

            // After another 5 seconds
            await vi.advanceTimersByTimeAsync(5000)
            expect(fetchMock).toHaveBeenCalledTimes(3)
        })
    })

    describe('status determination', () => {
        it('should mark as healthy when status is "healthy"', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'healthy', backend: 'cuda', platform: 'Linux', model_loaded: true })
            })

            service.start()
            await vi.advanceTimersByTimeAsync(0)

            expect(service.getStatus()).toBe(true)
        })

        it('should mark as unhealthy when status is not "healthy"', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'unhealthy', backend: 'cuda', platform: 'Linux', model_loaded: false })
            })

            service.start()
            await vi.runOnlyPendingTimersAsync()

            expect(service.getStatus()).toBe(false)
        })

        it('should mark as unhealthy when API is not accessible (network error)', async () => {
            expect.hasAssertions()

            fetchMock.mockRejectedValueOnce(new Error('Network Error'))

            service.start()
            await vi.runOnlyPendingTimersAsync()

            expect(service.getStatus()).toBe(false)
            expect(service.getHealthInfo()).toBeNull()
        })

        it('should mark as unhealthy when API times out', async () => {
            expect.hasAssertions()

            const timeoutError = new Error('Timeout')
            timeoutError.name = 'TimeoutError'
            fetchMock.mockRejectedValueOnce(timeoutError)

            service.start()
            await vi.runOnlyPendingTimersAsync()

            expect(service.getStatus()).toBe(false)
        })

        it('should mark as unhealthy when response is not valid JSON', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => {
                    throw new Error('Invalid JSON')
                }
            })

            service.start()
            await vi.runOnlyPendingTimersAsync()

            expect(service.getStatus()).toBe(false)
        })

        it('should mark as unhealthy when HTTP status is not ok', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            })

            service.start()
            await vi.runOnlyPendingTimersAsync()

            expect(service.getStatus()).toBe(false)
        })
    })

    describe('state recovery', () => {
        it('should recover to healthy state after service comes back', async () => {
            expect.hasAssertions()

            // First call fails
            fetchMock.mockRejectedValueOnce(new Error('Network Error'))

            service.start()
            await vi.runOnlyPendingTimersAsync()

            expect(service.getStatus()).toBe(false)

            // Second call succeeds
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'healthy', backend: 'cuda', platform: 'Linux', model_loaded: true })
            })

            // Wait for the next check (5 seconds interval)
            await vi.advanceTimersByTimeAsync(5000)

            expect(service.getStatus()).toBe(true)
        })
    })

    describe('getStatus and getHealthInfo', () => {
        it('should return current status', () => {
            expect(service.getStatus()).toBe(true) // Default state
        })

        it('should return health info after successful check', async () => {
            expect.hasAssertions()

            const healthResponse: HealthResponse = {
                status: 'healthy',
                backend: 'cuda',
                platform: 'Linux',
                model_loaded: true
            }

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => healthResponse
            })

            service.start()
            await vi.advanceTimersByTimeAsync(0)

            expect(service.getHealthInfo()).toEqual(healthResponse)
        })

        it('should return null health info after failed check', async () => {
            expect.hasAssertions()

            fetchMock.mockRejectedValueOnce(new Error('Network Error'))

            service.start()
            await vi.runOnlyPendingTimersAsync()

            expect(service.getHealthInfo()).toBeNull()
        })
    })

    describe('lastCheckTime', () => {
        it('should update lastCheckTime after each check', async () => {
            expect.hasAssertions()

            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({ status: 'healthy', backend: 'cuda', platform: 'Linux', model_loaded: true })
            })

            const initialTime = service.getLastCheckTime()
            expect(initialTime).toBeNull()

            service.start()
            await vi.runOnlyPendingTimersAsync()

            const firstCheckTime = service.getLastCheckTime()
            expect(firstCheckTime).toBeInstanceOf(Date)

            // Advance system time to ensure next check has different timestamp
            vi.setSystemTime(Date.now() + 100)

            await vi.advanceTimersByTimeAsync(5000)

            const secondCheckTime = service.getLastCheckTime()
            expect(secondCheckTime).toBeInstanceOf(Date)
            expect(secondCheckTime!.getTime()).toBeGreaterThan(firstCheckTime!.getTime())
        })
    })

    describe('v5 503 bodies', () => {
        const res503 = (body: unknown) => ({
            ok: false, status: 503, statusText: 'Service Unavailable', json: async () => body
        })

        it('treats 503 status=starting as starting (healthy for queueing, not ready)', async () => {
            fetchMock.mockResolvedValueOnce(res503({ status: 'starting', ready: false, model_loaded: false, backend: 'cuda' }))
            await service.checkNow()
            expect(service.getServiceState()).toBe('starting')
            expect(service.getStatus()).toBe(true)
            expect(service.getHealthInfo()?.status).toBe('starting')
        })

        it('treats 503 status=error as model error with load_error', async () => {
            fetchMock.mockResolvedValueOnce(res503({ status: 'error', ready: false, load_error: 'weights missing' }))
            await service.checkNow()
            expect(service.getServiceState()).toBe('error')
            expect(service.getStatus()).toBe(false)
            expect(service.getHealthInfo()?.load_error).toBe('weights missing')
        })

        it('treats 503 without a v5 body as unavailable', async () => {
            fetchMock.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'x', json: async () => { throw new Error('html') } })
            await service.checkNow()
            expect(service.getServiceState()).toBe('unavailable')
            expect(service.getHealthInfo()).toBeNull()
        })

        it('treats network failure as unavailable and 200 as ready', async () => {
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
            await service.checkNow()
            expect(service.getServiceState()).toBe('unavailable')
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'busy', ready: true }) })
            await service.checkNow()
            expect(service.getServiceState()).toBe('ready')
            expect(service.getStatus()).toBe(true)
        })
    })
})
