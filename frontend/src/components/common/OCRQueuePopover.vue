<template>
  <div 
    class="ocr-queue-container"
    data-testid="ocr-queue-popover"
  >
    <!-- Header -->
    <div class="queue-header">
      <div class="header-title">
        <span class="title-text">{{ t('ocrQueuePopover.title') }}</span>
        <NBadge
          :value="store.ocrTaskCount"
          type="success"
        />
      </div>
      <div class="header-actions" />
    </div>

    <!-- Service state banner (v5: model loading / load failure) -->
    <div
      v-if="healthStore.isStarting"
      class="service-banner is-warning"
      data-testid="ocr-queue-model-loading"
    >
      {{ t('ocrQueuePopover.modelLoading') }}
    </div>
    <div
      v-else-if="healthStore.isModelError"
      class="service-banner is-error"
      data-testid="ocr-queue-model-error"
    >
      {{ t('ocrQueuePopover.modelError', [healthStore.loadError || '-']) }}
    </div>
    <div
      v-if="engineSummary"
      class="engine-line"
      data-testid="ocr-queue-engine"
    >
      {{ engineSummary }}
    </div>

    <!-- Toolbar (Check All) - Fixed at top -->
    <div
      v-if="store.ocrTaskCount > 0"
      class="list-toolbar"
      data-testid="ocr-queue-toolbar"
    >
      <NCheckbox
        data-testid="ocr-queue-select-all"
        :checked="isAllSelected"
        :indeterminate="isPartiallySelected"
        size="small"
        @update:checked="handleSelectAll"
      />

      <!-- Remove Selected -->
      <NButton
        v-if="hasSelection"
        data-testid="ocr-queue-batch-cancel-btn"
        size="medium"
        text
        :title="t('ocrQueuePopover.cancelSelected')"
        class="action-btn"
        @click="handleStopSelected"
        @mouseenter="hoveredBtnId = 'batch'"
        @mouseleave="hoveredBtnId = null"
      >
        <template #icon>
          <NIcon color="#d03050">
            <CloseCircle v-if="hoveredBtnId === 'batch'" />
            <CloseCircleOutline v-else />
          </NIcon>
        </template>
      </NButton>
    </div>

    <!-- Task List -->
    <NScrollbar style="max-height: 300px">
      <div
        v-if="store.ocrTaskCount === 0"
        class="empty-state"
      >
        <NEmpty
          :description="t('ocrQueue.noActiveTasks')"
          size="small"
        />
      </div>
      
      <div
        v-else
        class="task-list"
      >
        <!-- Processing Tasks -->
        <div
          v-for="page in store.activeOCRTasks"
          :key="page.id"
          class="task-item processing"
          :data-testid="`ocr-queue-item-${page.id}`"
          data-status="processing"
        >
          <NCheckbox 
            data-testid="ocr-queue-task-checkbox"
            size="small"
            :checked="selectedIds.has(page.id)"
            @update:checked="(v) => handleItemSelect(page.id, v)"
          />
          <div class="task-info">
            <NSpin size="small" />
            <div class="file-details">
              <span class="file-name">{{ page.fileName }}</span>
              <span class="status-text">{{ getTaskStatusText() }}</span>
            </div>
          </div>
          <NButton
            size="medium"
            circle
            text
            data-testid="ocr-queue-task-cancel-btn"
            class="cancel-btn"
            :title="t('ocrQueuePopover.cancelTask')"
            @click="handleStopSingle(page.id)"
            @mouseenter="hoveredBtnId = page.id"
            @mouseleave="hoveredBtnId = null"
          >
            <template #icon>
              <NIcon color="#d03050">
                <CloseCircle v-if="hoveredBtnId === page.id" />
                <CloseCircleOutline v-else />
              </NIcon>
            </template>
          </NButton>
        </div>

        <!-- Queued Tasks -->
        <div
          v-for="page in store.queuedOCRTasks"
          :key="page.id"
          class="task-item queued"
          :data-testid="`ocr-queue-item-${page.id}`"
          data-status="queued"
        >
          <NCheckbox 
            data-testid="ocr-queue-task-checkbox"
            :checked="selectedIds.has(page.id)"
            @update:checked="(v) => handleItemSelect(page.id, v)"
          />
          <div class="task-info">
            <NIcon
              size="18"
              color="#666"
            >
              <TimeOutline />
            </NIcon>
            <div class="file-details">
              <span class="file-name">{{ page.fileName }}</span>
              <span class="status-text">{{ t('ocrQueuePopover.waiting') }}</span>
            </div>
          </div>
          <NButton
            size="medium"
            circle
            text
            data-testid="ocr-queue-task-cancel-btn"
            class="cancel-btn"
            :title="t('ocrQueuePopover.cancelTask')"
            @click="handleStopSingle(page.id)"
            @mouseenter="hoveredBtnId = page.id"
            @mouseleave="hoveredBtnId = null"
          >
            <template #icon>
              <NIcon color="#d03050">
                <CloseCircle v-if="hoveredBtnId === page.id" />
                <CloseCircleOutline v-else />
              </NIcon>
            </template>
          </NButton>
        </div>
      </div>
    </NScrollbar>

    <!-- Footer -->
    <div class="queue-footer">
      <NButton
        data-testid="ocr-queue-close-btn"
        type="primary"
        size="medium"
        block
        class="footer-close-btn"
        @click="$emit('close')"
      >
        <template #icon>
          <NIcon>
            <CloseCircle />
          </NIcon>
        </template>
        {{ t('ocrQueuePopover.close') }}
      </NButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePagesStore } from '@/stores/pages'
import { useHealthStore } from '@/stores/health'
import { NButton, NIcon, NBadge, NScrollbar, NEmpty, NCheckbox, NSpin, createDiscreteApi } from 'naive-ui'
import { CloseCircleOutline, CloseCircle, TimeOutline } from '@vicons/ionicons5'

const store = usePagesStore()
const healthStore = useHealthStore()
const { t } = useI18n()
const { message } = createDiscreteApi(['message'])

defineEmits<{
  (e: 'close'): void
}>()

// Local selection state
const selectedIds = ref<Set<string>>(new Set())
const hoveredBtnId = ref<string | null>(null) // 'batch' or page.id

// Computed
const allTaskIds = computed(() => [
  ...store.activeOCRTasks.map(p => p.id),
  ...store.queuedOCRTasks.map(p => p.id)
])

const hasSelection = computed(() => selectedIds.value.size > 0)
const isAllSelected = computed(() => allTaskIds.value.length > 0 && selectedIds.value.size === allTaskIds.value.length)


const isPartiallySelected = computed(() => selectedIds.value.size > 0 && selectedIds.value.size < allTaskIds.value.length)



// "vllm · cuda · bfloat16 · v5.0.0" from /health (v5); empty on v4 backends without engine info
const engineSummary = computed(() => {
  const engine = healthStore.engineInfo
  const parts = [engine?.engine, engine?.device, engine?.dtype].filter((v): v is string => typeof v === 'string' && v !== '')
  if (healthStore.serverVersion) parts.push(`v${healthStore.serverVersion}`)
  return parts.join(' · ')
})

// Dynamic Status Text
function getTaskStatusText() {
  const position = healthStore.queuePosition
  
  // Position 1 = currently processing
  if (position === 1) {
    return t('ocrQueue.processing', [position])
  }
  
  // Position > 1 = in queue
  if (position && position > 1) {
    return t('ocrQueue.queuePosition', [position])
  }
  
  // No position info = submitting to queue
  return t('ocrQueue.submitting')
}

// Watcher to prune selectedIds when tasks are removed (e.g. completed)
import { watch } from 'vue'
watch(allTaskIds, (newIds) => {
  const newIdSet = new Set(newIds)
  const idsToRemove: string[] = []
  
  // Find IDs that are no longer in the list
  selectedIds.value.forEach(id => {
    if (!newIdSet.has(id)) {
      idsToRemove.push(id)
    }
  })
  
  // Remove them
  if (idsToRemove.length > 0) {
    idsToRemove.forEach(id => selectedIds.value.delete(id))
  }
}, { deep: true })

// Actions
function handleItemSelect(id: string, checked: boolean) {
  if (checked) {
    selectedIds.value.add(id)
  } else {
    selectedIds.value.delete(id)
  }
}

function handleSelectAll(checked: boolean) {
  if (checked) {
    allTaskIds.value.forEach(id => selectedIds.value.add(id))
  } else {
    selectedIds.value.clear()
  }
}

async function handleStopSingle(id: string) {
  await store.cancelOCRTasks([id])
  selectedIds.value.delete(id)
  message.info(t('ocrQueuePopover.taskCancelled'))
}

// Unified action for "Remove Selected" (Batch)
async function handleStopSelected() {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return

  const originalCount = ids.length
  await store.cancelOCRTasks(ids)
  selectedIds.value.clear()
  message.success(t('ocrQueuePopover.tasksCancelled', { n: originalCount }))
}

// Remove All
async function handleStopAll() {
  await store.cancelOCRTasks(allTaskIds.value)
  selectedIds.value.clear()
  message.success(t('ocrQueuePopover.allTasksCancelled'))
}

defineExpose({
  selectedIds,
  allTaskIds,
  isAllSelected,
  isPartiallySelected,
  handleStopAll,
  handleStopSelected,
  handleStopSingle,
  handleSelectAll,
  handleItemSelect
})
</script>

<style scoped>
.ocr-queue-container {
  width: 400px;
  background: white;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 6px 16px -4px rgba(0, 0, 0, 0.12), 0 12px 32px 0 rgba(0, 0, 0, 0.08), 0 16px 48px 16px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(239, 239, 245, 1);
}

.queue-header {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.service-banner {
  padding: 6px 16px;
  font-size: 12px;
  line-height: 1.5;
}

.service-banner.is-warning {
  background: #fff7e6;
  color: #ad6800;
}

.service-banner.is-error {
  background: #fff1f0;
  color: #a8071a;
  word-break: break-word;
}

.engine-line {
  padding: 4px 16px;
  font-size: 11px;
  color: #888;
  border-bottom: 1px solid #f0f0f0;
}

.list-toolbar {
  padding: 4px 16px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 38px;
}

.task-list {
  display: flex;
  flex-direction: column;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f9f9f9;
  transition: background 0.2s;
}

.task-item:hover {
  background: #fdfdfd;
}

.task-item .cancel-btn {
  opacity: 0;
  transition: opacity 0.2s;
}

.task-item:hover .cancel-btn {
  opacity: 1;
}

.task-item.processing {
  background: #f0fdf4; /* Green tint */
}

.task-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
}

.file-details {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-text {
  font-size: 11px;
  color: #666;
}

.queue-footer {
  padding: 8px 16px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
}

.empty-state {
  padding: 40px 0;
}
</style>
