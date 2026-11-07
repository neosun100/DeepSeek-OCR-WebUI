import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { HealthCheckService } from '@/services/health'
import type { HealthResponse, ServiceState } from '@/services/health'
import { config } from '@/config'

export const useHealthStore = defineStore('health', () => {
    // State
    // isHealthy = "service can accept tasks": true for ready AND starting (tasks queue and wait
    // for the model), false for model load error / unreachable. Use isReady for "model loaded".
    const isHealthy = ref(true)
    const serviceState = ref<ServiceState>('unknown')
    const healthInfo = ref<HealthResponse | null>(null)
    const lastCheckTime = ref<Date | null>(null)
    const error = ref<Error | null>(null)

    // Private members
    let healthService: HealthCheckService | null = null
    let checkInterval: number | null = null

    /**
     * Start health check polling
     */
    function startHealthCheck() {
        // Create service instance if not exists
        if (!healthService) {
            healthService = new HealthCheckService(config.apiBaseUrl)
        }

        // Start the service
        healthService.start()

        // Update status immediately
        updateStatus()

        // Set up periodic status updates
        if (checkInterval === null) {
            checkInterval = window.setInterval(() => {
                updateStatus()
            }, 1000) // Update UI every second
        }
    }

    /**
     * Stop health check polling
     */
    function stopHealthCheck() {
        if (healthService) {
            healthService.stop()
        }

        if (checkInterval !== null) {
            window.clearInterval(checkInterval)
            checkInterval = null
        }
    }

    /**
     * Update status from health service
     */
    function updateStatus() {
        if (!healthService) return

        isHealthy.value = healthService.getStatus()
        serviceState.value = healthService.getServiceState()
        healthInfo.value = healthService.getHealthInfo()
        lastCheckTime.value = healthService.getLastCheckTime()
    }

    /**
     * Check immediately and refresh the UI state (used when the tab becomes visible again)
     */
    async function checkNow() {
        if (!healthService) return
        await healthService.checkNow()
        updateStatus()
    }

    // Computed properties for easy access
    const queueStatus = computed(() => healthInfo.value?.ocr_queue)
    const rateLimits = computed(() => healthInfo.value?.rate_limits)
    const yourQueueStatus = computed(() => healthInfo.value?.your_queue_status)

    // Service state helpers
    const isReady = computed(() => serviceState.value === 'ready')
    const isStarting = computed(() => serviceState.value === 'starting')
    const isModelError = computed(() => serviceState.value === 'error')
    const isUnreachable = computed(() => serviceState.value === 'unavailable')
    const loadError = computed(() => healthInfo.value?.load_error ?? null)
    const engineInfo = computed(() => healthInfo.value?.engine ?? null)
    const serverVersion = computed(() => healthInfo.value?.version ?? null)

    // Status helpers
    const isBusy = computed(() => {
        if (!healthInfo.value) return false
        return healthInfo.value.status === 'busy'
    })

    const isFull = computed(() => {
        if (!healthInfo.value) return false
        return healthInfo.value.status === 'full'
    })

    // Queue position helpers
    const queuePosition = computed(() => {
        return healthInfo.value?.your_queue_status?.position ?? null
    })

    const isProcessing = computed(() => {
        return queuePosition.value === 1
    })

    const isQueued = computed(() => {
        return (queuePosition.value ?? 0) > 1
    })

    return {
        // State
        isHealthy,
        serviceState,
        healthInfo,
        lastCheckTime,
        error,

        // Computed
        isReady,
        isStarting,
        isModelError,
        isUnreachable,
        loadError,
        engineInfo,
        serverVersion,
        queueStatus,
        rateLimits,
        yourQueueStatus,
        isBusy,
        isFull,
        queuePosition,
        isProcessing,
        isQueued,

        // Actions
        startHealthCheck,
        stopHealthCheck,
        updateStatus,
        checkNow
    }
})
