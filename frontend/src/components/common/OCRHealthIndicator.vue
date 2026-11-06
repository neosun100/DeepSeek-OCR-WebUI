<template>
  <NBadge
    :dot="true"
    :color="statusColor"
    :processing="!isHealthy || isStarting"
    :offset="compact ? [-2, 2] : [0, 0]"
  >
    <NTooltip
      v-bind="tooltipProps"
      :theme-overrides="{
        color: statusColor,
        textColor: '#fff'
      }"
    >
      <template #trigger>
        <NButton
          text
          size="small"
          :type="buttonType"
          class="health-indicator-btn"
          :class="{ 'is-compact': compact }"
          data-testid="health-indicator"
          :data-state="serviceState"
        >
          <template #icon>
            <NIcon :component="StatusIcon" />
          </template>
          <span v-if="!compact">{{ $t('health.ocrService') }}</span>
        </NButton>
      </template>
      <div
        class="health-tooltip"
        data-testid="health-tooltip"
      >
        <div class="health-status">
          <strong>{{ $t('health.status') }}:</strong> {{ statusText }}
        </div>
        <div
          v-if="isStarting"
          data-testid="health-starting-hint"
        >
          {{ $t('health.startingTooltip') }}
        </div>
        <div
          v-if="isModelError"
          class="health-error"
          data-testid="health-load-error"
        >
          {{ $t('health.modelErrorDetail', [loadError || '-']) }}
        </div>
        <div v-if="isUnreachable">
          {{ $t('health.unreachableTooltip') }}
        </div>
        <template v-if="healthInfo">
          <div v-if="healthInfo.version">
            <strong>{{ $t('health.version') }}:</strong> {{ healthInfo.version }}<span v-if="healthInfo.model_version"> · {{ healthInfo.model_version }}</span>
          </div>
          <div v-if="engineInfo?.engine">
            <strong>{{ $t('health.engine') }}:</strong> {{ engineInfo.engine }}
          </div>
          <div
            v-if="engineInfo?.device || healthInfo.backend"
            data-testid="health-device"
          >
            <strong>{{ $t('health.device') }}:</strong> {{ engineInfo?.device || healthInfo.backend }}<span v-if="engineInfo?.dtype"> · {{ $t('health.dtype') }} {{ engineInfo.dtype }}</span>
          </div>
          <div v-if="healthInfo.platform">
            <strong>{{ $t('health.platform') }}:</strong> {{ healthInfo.platform }}
          </div>
          <div v-if="healthInfo.ocr_queue">
            <strong>{{ $t('health.queue') }}:</strong> {{ healthInfo.ocr_queue.depth }} / {{ healthInfo.ocr_queue.max_size }}
          </div>
          <div v-if="isBusy">
            {{ $t('health.busyTooltip') }}
          </div>
          <div v-if="isFull">
            {{ $t('health.fullTooltip') }}
          </div>
        </template>
        <div
          v-if="lastCheckTime"
          class="health-time"
        >
          {{ $t('health.lastCheck') }}: {{ formatTime(lastCheckTime) }}
        </div>
      </div>
    </NTooltip>
  </NBadge>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NBadge, NButton, NIcon, NTooltip } from 'naive-ui'
import { HeartOutline, AlertCircleOutline, HourglassOutline } from '@vicons/ionicons5'
import { useHealthStore } from '@/stores/health'
import { PRIMARY_COLOR } from '@/theme/vars'


// No props needed
defineProps<{
  compact?: boolean
}>()

const { t } = useI18n()
const healthStore = useHealthStore()

const isHealthy = computed(() => healthStore.isHealthy)
const healthInfo = computed(() => healthStore.healthInfo)
const lastCheckTime = computed(() => healthStore.lastCheckTime)

const isBusy = computed(() => healthStore.isBusy)
const isFull = computed(() => healthStore.isFull)
const isStarting = computed(() => healthStore.isStarting)
const isModelError = computed(() => healthStore.isModelError)
const isUnreachable = computed(() => healthStore.isUnreachable)
const serviceState = computed(() => healthStore.serviceState)
const loadError = computed(() => healthStore.loadError)
const engineInfo = computed(() => healthStore.engineInfo)

const WARNING_COLOR = '#f0a020'
const ERROR_COLOR = '#d03050'

// Priority: hard failures first, then transient states, then load levels
const statusColor = computed(() => {
  if (isModelError.value || !isHealthy.value) return ERROR_COLOR
  if (isStarting.value) return WARNING_COLOR
  if (isFull.value) return ERROR_COLOR
  if (isBusy.value) return WARNING_COLOR
  return PRIMARY_COLOR
})

const buttonType = computed(() => {
  if (isModelError.value || !isHealthy.value) return 'error'
  if (isStarting.value) return 'warning'
  if (isFull.value) return 'error'
  if (isBusy.value) return 'warning'
  return 'success'
})

const StatusIcon = computed(() => {
  if (isStarting.value) return HourglassOutline
  return isHealthy.value ? HeartOutline : AlertCircleOutline
})

const statusText = computed(() => {
  if (isModelError.value) return t('health.modelError')
  if (!isHealthy.value) return t('health.unavailable')
  if (isStarting.value) return t('health.starting')
  if (isFull.value) return t('health.full')
  if (isBusy.value) return t('health.busy')
  return t('health.healthy')
})

function formatTime(date: Date): string {
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  
  if (diff < 10) return t('health.justNow')
  if (diff < 60) return t('health.ago', [diff])
  if (diff < 3600) return t('health.minutesAgo', [Math.floor(diff / 60)])
  return date.toLocaleTimeString()
}

// Tooltip props for consistent style
const tooltipProps = {
  placement: 'bottom' as const,
  trigger: 'hover' as const
}
</script>

<style scoped>
.health-indicator-btn {
  padding: 0 4px;
  height: 24px;
}

.health-indicator-btn.is-compact {
  padding: 0;
  width: 24px;
  justify-content: center;
}

.health-tooltip {
  font-size: 12px;
  line-height: 1.6;
}

.health-status {
  margin-bottom: 4px;
}

.health-error {
  font-weight: 600;
  word-break: break-word;
}

.health-time {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.8;
}
</style>
