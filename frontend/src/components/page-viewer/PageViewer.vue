<template>
  <div 
    data-testid="page-viewer"
    :data-current-page-id="currentPage?.id"
    class="page-viewer"
  >
    <!-- Header with page info and controls -->
    <NCard
      class="viewer-header"
      size="small"
      :bordered="false"
    >
      <NSpace
        justify="space-between"
        align="center"
      >
        <h3 class="page-title">
          {{ currentPage?.fileName || '---' }}
        </h3>
        <NSpace
          align="center"
          size="small"
        >
          <div 
            data-testid="ocr-actions-container"
            class="ocr-actions keep-queue-open"
          >
            <OCRModeSelector 
              :loading="status === 'recognizing'"
              :disabled="!currentPage || isPageProcessing"
              @run="handleOCRRun"
            />
          </div>
          <NDivider vertical />
          <NSpace
            align="center"
            size="small"
          >
            <NSwitch 
              :value="pagesStore.showOverlay" 
              size="small"
              :title="pagesStore.showOverlay ? $t('pageViewer.hideOverlay') : $t('pageViewer.showOverlayTooltip')"
              @update:value="pagesStore.setShowOverlay"
            >
              <template #checked-icon>
                <NIcon :component="ColorWand" />
              </template>
              <template #unchecked-icon>
                <NIcon :component="ColorWandOutline" />
              </template>
            </NSwitch>
            <NDivider vertical />
            <NButtonGroup size="small">
              <NButton
                :disabled="zoomLevel <= 0.25"
                @click="zoomOut"
              >
                <template #icon>
                  −
                </template>
              </NButton>
              <NButton disabled>
                {{ Math.round(zoomLevel * 100) }}%
              </NButton>
              <NButton
                :disabled="zoomLevel >= 3"
                @click="zoomIn"
              >
                <template #icon>
                  +
                </template>
              </NButton>
            </NButtonGroup>
            <NButton
              size="small"
              @click="fitToScreen"
            >
              {{ $t('pageViewer.fit') }}
            </NButton>
          </NSpace>
        </NSpace>
      </NSpace>
    </NCard>

    <!-- Main image display area -->
    <div
      ref="imageContainer"
      class="image-container"
    >
      <div
        v-if="currentPage"
        class="image-wrapper"
      >
        <div 
          v-if="fullImageUrl"
          class="scalable-content"
          :style="{
            transform: `scale(${zoomLevel})`,
            aspectRatio: naturalWidth && naturalHeight ? `${naturalWidth} / ${naturalHeight}` : 'auto'
          }"
        >
          <img
            data-testid="page-image"
            :src="fullImageUrl"
            class="page-image"
            alt="Page image"
            @load="onImageLoad"
            @error="onImageError"
          >
          <!-- OCR Result Overlay inside the scaled group -->
          <OCRResultOverlay
            v-if="ocrResult?.raw_text && !imageLoading && pagesStore.showOverlay"
            :raw-text="ocrResult.raw_text"
            :image-dims="ocrResult.image_dims"
          />
        </div>
        
        <NEmpty
          v-else-if="!imageLoading"
          :description="$t('pageViewer.noImageAvailable')"
        >
          <template #icon>
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="2"
                ry="2"
              />
              <circle
                cx="8.5"
                cy="8.5"
                r="1.5"
              />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </template>
        </NEmpty>

        <!-- Loading overlay -->
        <NSpin
          v-if="imageLoading"
          size="large"
          class="loading-overlay"
        >
          <template #description>
            {{ $t('pageViewer.loadingImage') }}
          </template>
        </NSpin>

        <!-- Error overlay -->
        <NResult
          v-if="imageError"
          status="error"
          :title="imageError"
          class="error-overlay"
        />
      </div>
      <NEmpty
        v-else
        :description="$t('pageViewer.selectPageToView')"
        class="placeholder-select"
      >
        <template #icon>
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line
              x1="16"
              y1="13"
              x2="8"
              y2="13"
            />
            <line
              x1="16"
              y1="17"
              x2="8"
              y2="17"
            />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </template>
      </NEmpty>
    </div>

    <!-- Bottom toolbar -->
    <NCard
      class="viewer-toolbar"
      size="small"
      :bordered="false"
    >
      <NSpace
        justify="space-between"
        align="center"
      >
        <NSpace size="medium">
          <NText depth="3">
            {{ $t('pageViewer.status') }}: <NText
              :type="getStatusType()"
              depth="1"
            >
              {{ statusText }}
            </NText>
          </NText>
          <NText
            v-if="imageSize"
            depth="3"
          >
            {{ $t('pageViewer.size') }}: <NText depth="1">
              {{ imageSize }}
            </NText>
          </NText>
          <NText
            v-if="currentPage?.fileSize !== undefined"
            depth="3"
          >
            {{ $t('pageViewer.file') }}: <NText depth="1">
              {{ formatFileSize(currentPage.fileSize) }}
            </NText>
          </NText>
        </NSpace>
      </NSpace>
    </NCard>

    <!-- Raw Text Panel -->
    <OCRRawTextPanel
      v-if="ocrResult?.raw_text"
      :text="ocrResult.raw_text"
      :warnings="ocrResult.warnings"
      :finish-reason="ocrResult.finish_reason"
    />

    <!-- Input Modal -->
    <OCRInputModal
      v-model:show="inputModalShow"
      :mode="targetInputMode"
      @submit="handleInputSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { uiLogger } from '@/utils/logger'
import { NCard, NSpace, NButton, NButtonGroup, NSpin, NEmpty, NResult, NText, NSwitch, NIcon, NDivider } from 'naive-ui'
import { ColorWand, ColorWandOutline } from '@vicons/ionicons5'
import { db } from '@/db'
import { ocrService, type OCRResult, type OCRPromptType } from '@/services/ocr'
import { useMessage, useNotification, useDialog } from 'naive-ui'
import { usePagesStore } from '@/stores/pages'
import { useHealthStore } from '@/stores/health'
import OCRModeSelector from '@/components/ocr/OCRModeSelector.vue'
import OCRInputModal from '@/components/ocr/OCRInputModal.vue'
import OCRResultOverlay from '@/components/ocr/OCRResultOverlay.vue'
import OCRRawTextPanel from '@/components/ocr/OCRRawTextPanel.vue'

import type { Page } from '@/stores/pages'

const { t } = useI18n()

const props = defineProps<{
  currentPage?: Page | null
}>()




const message = useMessage()
const notification = useNotification()
const dialog = useDialog()
const pagesStore = usePagesStore()
const healthStore = useHealthStore()
const zoomLevel = ref(1)
// const imageContainer = ref<HTMLElement>() // Unused ref removed
const imageSize = ref<string>('')
const imageLoading = ref(false)
const imageError = ref<string>('')
const fullImageUrl = ref<string>('')
const ocrResult = ref<OCRResult | undefined>()

// Image dimensions for aspect ratio lock
const naturalWidth = ref<number | null>(null)
const naturalHeight = ref<number | null>(null)

// Input Modal State
const inputModalShow = ref(false)
const targetInputMode = ref<OCRPromptType>('find')

const status = computed(() => props.currentPage?.status || 'ready')

// Watch for page change or status change to load full image
watch(
  [() => props.currentPage?.id, () => props.currentPage?.status],
  async ([newPageId, newStatus], [oldPageId, oldStatus]) => {
    await handlePageChange(newPageId, newStatus, oldPageId, oldStatus)
  },
  { immediate: true }
)

/**
 * Handle page or status change to load full image
 */
async function handlePageChange(
  newPageId: string | undefined, 
  newStatus: string | undefined, 
  oldPageId: string | undefined, 
  oldStatus: string | undefined
) {
  // 1. Process OCR completion independently if it just happened
  await handleOCRCompletion(newPageId, newStatus, oldStatus)

  // 2. Always attempt to load the page content/image
  await handlePageLoad(newPageId, newStatus, oldPageId, oldStatus)
}

async function handleOCRCompletion(
  pageId: string | undefined,
  newStatus: string | undefined,
  oldStatus: string | undefined
): Promise<boolean> {
  // Only reload OCR results when OCR **just** completed (status transition from non-success to success)
  // Do NOT trigger during initialization (when oldStatus is undefined)
  const ocrJustFinished = newStatus === 'ocr_success' && oldStatus !== undefined && oldStatus !== 'ocr_success'
  if (ocrJustFinished && pageId) {
      await loadOCRResult(pageId)
      return true
  }
  return false
}

function shouldTriggerPageLoad(
  newPageId: string | undefined,
  newStatus: string | undefined,
  oldPageId: string | undefined,
  oldStatus: string | undefined
) {
  const idChanged = newPageId !== oldPageId
  const isInitialization = !oldPageId && !!newPageId
  
  // Load image if: page changed, OR it's initialization, OR became viewable
  const isViewable = ['ready', 'ocr_success', 'completed'].includes(String(newStatus))
  const wasNotViewable = !oldStatus || !['ready', 'ocr_success', 'completed'].includes(String(oldStatus))
  const viewableTransition = isViewable && wasNotViewable

  return idChanged || isInitialization || viewableTransition
}

async function handlePageLoad(
  newPageId: string | undefined,
  newStatus: string | undefined,
  oldPageId: string | undefined,
  oldStatus: string | undefined
) {
  if (!shouldTriggerPageLoad(newPageId, newStatus, oldPageId, oldStatus)) return

  const idChanged = newPageId !== oldPageId
  if (idChanged) {
      cleanupPreviousUrl(true)
  }
  
  if (!newPageId || newStatus === 'pending_render' || newStatus === 'rendering') return

  await Promise.all([
    loadPageBlob(newPageId),
    loadOCRResult(newPageId)
  ])
}

/**
 * Cleanup previous object URL
 */
function cleanupPreviousUrl(idChanged: boolean) {
  if (idChanged && fullImageUrl.value) {
    URL.revokeObjectURL(fullImageUrl.value)
    fullImageUrl.value = ''
    naturalWidth.value = null
    naturalHeight.value = null
  }
  imageError.value = ''
  imageSize.value = ''
  ocrResult.value = undefined
}

/**
 * Load image blob from DB with a retry for stability (esp. for Webkit)
 */
async function loadPageBlob(pageId: string, retry = true) {
  imageLoading.value = true
  try {
    const blob = await db.getPageImage(pageId)
    if (blob) {
      fullImageUrl.value = URL.createObjectURL(blob)
      imageError.value = ''
    } else if (retry) {
      // Small delay and retry once - sometimes IDB is not ready immediately in Safari
      await new Promise(resolve => setTimeout(resolve, 100))
      await loadPageBlob(pageId, false)
    } else {
      imageError.value = t('pageViewer.fullImageNotFound')
    }
  } catch (error) {
    uiLogger.error('Failed to load full image', error)
    if (retry) {
      await new Promise(resolve => setTimeout(resolve, 100))
      await loadPageBlob(pageId, false)
    } else {
      imageError.value = t('pageViewer.failedToLoadFromStorage')
    }
  } finally {
    if (!retry) {
      imageLoading.value = false
    }
  }
}

/**
 * Load OCR result from DB
 */
async function loadOCRResult(pageId: string) {
  try {
    const record = await db.getPageOCR(pageId)
    ocrResult.value = record?.data
  } catch (error) {
    uiLogger.error('Failed to load OCR result', error)
  }
}

// Cleanup on unmount
onUnmounted(() => {
  if (fullImageUrl.value) {
    URL.revokeObjectURL(fullImageUrl.value)
  }
})

const VIEW_STATUS_TEXT_MAP: Record<Page['status'] | 'ready', string> = {
  'pending_render': 'status.pendingRender',
  'rendering': 'status.rendering',
  'ready': 'status.ready',
  'pending_ocr': 'status.ocrQueued',
  'recognizing': 'status.recognizing',
  'ocr_success': 'status.ocrDone',
  'pending_gen': 'status.waitingForGen',
  'generating_markdown': 'status.generatingMarkdown',
  'markdown_success': 'status.markdownReady',
  'generating_pdf': 'status.generatingPDF',
  'pdf_success': 'status.pdfReady',
  'generating_docx': 'status.generatingDOCX',
  'completed': 'status.completed',
  'error': 'status.error'
}

const statusText = computed(() => {
  const key = VIEW_STATUS_TEXT_MAP[status.value as Page['status']] || 'status.unknown'
  return t(key)
})

const VIEW_STATUS_TYPE_MAP: Record<Page['status'] | 'ready', 'success' | 'info' | 'warning' | 'error' | 'default'> = {
  'completed': 'success',
  'ready': 'success',
  'ocr_success': 'success',
  'markdown_success': 'success',
  'pdf_success': 'success',
  'rendering': 'info',
  'recognizing': 'info',
  'pending_ocr': 'info',
  'pending_gen': 'info',
  'generating_markdown': 'info',
  'generating_pdf': 'info',
  'generating_docx': 'info',
  'error': 'error',
  'pending_render': 'warning'
}

function getStatusType(): 'success' | 'info' | 'warning' | 'error' | 'default' {
  return VIEW_STATUS_TYPE_MAP[status.value as Page['status']] || 'default'
}

function zoomIn() {
  if (zoomLevel.value < 3) {
    zoomLevel.value += 0.25
  }
}

function zoomOut() {
  if (zoomLevel.value > 0.25) {
    zoomLevel.value -= 0.25
  }
}

function fitToScreen() {
  zoomLevel.value = 1
}

function onImageLoad(event: Event) {
  const img = event.target as HTMLImageElement
  naturalWidth.value = img.naturalWidth
  naturalHeight.value = img.naturalHeight
  imageSize.value = `${img.naturalWidth} × ${img.naturalHeight}`
  imageLoading.value = false
  imageError.value = ''
}

function onImageError() {
  imageSize.value = t('pageViewer.loadFailed')
  imageLoading.value = false
  imageError.value = t('pageViewer.failedToLoadImage')
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const isPageProcessing = computed(() => {
  const s = status.value
  return s === 'recognizing' || 
         s === 'pending_ocr' || 
         s === 'rendering' || 
         s === 'pending_render' ||
         s === 'pending_gen' ||
         s.startsWith('generating_')
})



function handleOCRRun(mode: OCRPromptType) {
  if (mode === 'find' || mode === 'freeform') {
    targetInputMode.value = mode
    inputModalShow.value = true
  } else {
    // Direct run
    submitOCR(mode)
  }
}

function handleInputSubmit(value: string) {
  const options = {
    custom_prompt: targetInputMode.value === 'freeform' ? value : undefined,
    find_term: targetInputMode.value === 'find' ? value : undefined
  }
  submitOCR(targetInputMode.value, options)
}

// eslint-disable-next-line complexity
async function submitOCR(mode: OCRPromptType, extraOptions: { custom_prompt?: string; find_term?: string } = {}) {
  if (!props.currentPage || isPageProcessing.value) return
  
  try {
    const imageBlob = await db.getPageImage(props.currentPage.id)

    if (!imageBlob) {
      message.error(t('ocr.couldNotRetrieveImage'))
      return
    }


    // Pre-check for Unavailable or Full status
    const isUnavailable = !healthStore.isHealthy
    const isQueueFull = healthStore.isFull

    if (isUnavailable || isQueueFull) {
      dialog.error({
        title: isQueueFull ? t('errors.ocrQueueFullTitle') : t('errors.ocrServiceUnavailableTitle'),
        content: isQueueFull ? t('errors.ocrQueueFull') : t('errors.ocrServiceUnavailable'),
        positiveText: t('common.ok')
      })
      return
    }

    uiLogger.info(`Adding page to OCR Queue (${mode}):`, props.currentPage.id)
    
    await ocrService.queueOCR(props.currentPage.id, imageBlob, {
      prompt_type: mode,
      ...extraOptions
    })

    // 注意: Naive UI 的 notification API 不支持 class 选项
    notification.success({
      content: t('ocr.addedToQueue'),
      duration: 2500,
      closable: false
    })

  } catch (error) {
    uiLogger.error('OCR Error:', error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    
    // 注意: Naive UI 的 message API 不支持 class 选项
    message.error(t('ocr.ocrFailed', [errorMsg]))
  }
}
// Removed old runOCR function in place of new handlers


</script>

<style scoped>
.page-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
}

.viewer-header {
  border-bottom: 1px solid var(--n-border-color);
}

.page-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--n-text-color);
}

.image-container {
  flex: 1;
  overflow: auto;
  display: flex;
  /* Use flex-start to prevent negative scroll area when content is taller than container */
  align-items: flex-start;
  justify-content: center;
  background: #f8f9fa;
  position: relative;
}

.image-wrapper {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 100%;
  padding: 20px;
  position: relative;
  /* Use margin auto for conditional centering - only centers when content is smaller */
  margin: auto 0;
}

.scalable-content {
  position: relative;
  display: inline-flex; /* Shrink to fit image */
  transform-origin: center;
  transition: transform 0.2s ease;
  max-width: 100%;
  max-height: 100%;
}

.page-image {
  display: block; /* Remove gap */
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}

.placeholder-select {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
}

.loading-overlay,
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
  z-index: 10;
}

.viewer-toolbar {
  border-top: 1px solid var(--n-border-color);
  background: #fafafa;
}
</style>