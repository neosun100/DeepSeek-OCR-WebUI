<template>
  <NMessageProvider placement="bottom-left">
    <NNotificationProvider placement="bottom-left">
      <NDialogProvider>
        <NLayout
          data-testid="app-container"
          class="app-container"
          @drop="handleDrop"
          @dragover="handleDragOver"
        >
          <!-- Header -->
          <AppHeader
            @add-files="handleFileAdd"
          />

          <!-- Main Content -->
          <NLayout
            has-sider
            class="app-main"
          >
            <div
              v-if="!pagesStore.isInitialized"
              class="app-loading-container"
            >
              <div class="app-loading-spinner" />
              <div class="app-loading-text">
                Loading...
              </div>
            </div>

            <div
              v-else-if="pagesStore.pages.length === 0"
              style="width: 100%; height: 100%"
            >
              <EmptyState @add-files="handleFileAdd" />
            </div>

            <template v-else>
              <!-- Page List with custom collapse trigger -->
              <NLayoutSider
                v-model:collapsed="pageListCollapsed"
                data-testid="page-list-sider"
                :width="260"
                :collapsed-width="0"
                collapse-mode="width"
                :show-trigger="false"
                class="page-list-sider"
              >
                <div
                  data-testid="page-list-container"
                  class="page-list-container"
                >
                  <PageList
                    :pages="pagesStore.pages"
                    :selected-id="selectedPageId"
                    @page-selected="handlePageSelected"
                    @page-deleted="handlePageDeleted"
                    @batch-deleted="handleBatchDeleted"
                  />
                </div>
              </NLayoutSider>

              <!-- Custom Page List Collapse Trigger (BTN-PL) - positioned outside sider -->
              <div class="sider-trigger-container">
                <NTooltip :placement="pageListCollapsed ? 'right' : 'left'">
                  <template #trigger>
                    <NButton
                      size="small"
                      circle
                      quaternary
                      class="sider-trigger-btn"
                      data-testid="collapse-list-button"
                      @click="pageListCollapsed = !pageListCollapsed"
                    >
                      <template #icon>
                        <NIcon>
                          <ChevronBackOutline v-if="!pageListCollapsed" />
                          <ChevronForwardOutline v-else />
                        </NIcon>
                      </template>
                    </NButton>
                  </template>
                  {{ pageListCollapsed ? $t('app.expandPageList') : $t('app.collapsePageList') }}
                </NTooltip>
              </div>

              <!-- Middle: Content area with PageViewer, Divider, and Preview -->
              <div class="content-area">
                <!-- PageViewer -->
                <div
                  v-if="!pageViewerCollapsed"
                  class="panel page-viewer-panel"
                  :style="{ width: pageViewerWidth }"
                >
                  <div
                    data-testid="page-viewer-container"
                    class="page-viewer-container"
                  >
                    <PageViewer
                      :current-page="currentPage"
                    />
                  </div>
                </div>

                <!-- Panel Divider (only show when both panels are visible or PageViewer collapsed) -->
                <div
                  v-if="!previewCollapsed"
                  class="panel-divider"
                >
                  <!-- PageViewer collapse: show when both expanded -->
                  <NTooltip
                    v-if="!pageViewerCollapsed"
                    placement="right"
                  >
                    <template #trigger>
                      <NButton
                        size="small"
                        circle
                        quaternary
                        data-testid="collapse-viewer-button"
                        @click="pageViewerCollapsed = true"
                      >
                        <template #icon>
                          <NIcon><ChevronBackOutline /></NIcon>
                        </template>
                      </NButton>
                    </template>
                    {{ $t('app.collapseViewer') }}
                  </NTooltip>

                  <!-- PageViewer expand: show when PV collapsed -->
                  <NTooltip
                    v-if="pageViewerCollapsed"
                    placement="right"
                  >
                    <template #trigger>
                      <NButton
                        size="small"
                        circle
                        quaternary
                        data-testid="expand-viewer-button"
                        @click="pageViewerCollapsed = false"
                      >
                        <template #icon>
                          <NIcon><ChevronForwardOutline /></NIcon>
                        </template>
                      </NButton>
                    </template>
                    {{ $t('app.expandViewer') }}
                  </NTooltip>

                  <!-- Preview collapse: show when both expanded -->
                  <NTooltip
                    v-if="!pageViewerCollapsed"
                    placement="left"
                  >
                    <template #trigger>
                      <NButton
                        size="small"
                        circle
                        quaternary
                        data-testid="collapse-preview-button"
                        @click="previewCollapsed = true"
                      >
                        <template #icon>
                          <NIcon><ChevronForwardOutline /></NIcon>
                        </template>
                      </NButton>
                    </template>
                    {{ $t('app.collapsePreview') }}
                  </NTooltip>
                </div>

                <!-- Preview -->
                <div
                  v-if="!previewCollapsed"
                  class="panel preview-panel"
                  :style="{ width: previewWidth }"
                >
                  <div
                    data-testid="preview-container"
                    class="preview-container"
                  >
                    <Preview
                      :current-page="currentPage"
                    />
                  </div>
                </div>

                <!-- Preview expand trigger (now part of flex layout, not absolute) -->
                <div
                  v-if="previewCollapsed"
                  class="right-edge-trigger"
                >
                  <NTooltip placement="left">
                    <template #trigger>
                      <NButton
                        size="small"
                        circle
                        quaternary
                        data-testid="expand-preview-button"
                        @click="previewCollapsed = false"
                      >
                        <template #icon>
                          <NIcon><ChevronBackOutline /></NIcon>
                        </template>
                      </NButton>
                    </template>
                    {{ $t('app.expandPreview') }}
                  </NTooltip>
                </div>
              </div>
            </template>
          </NLayout>
        </NLayout>
      </NDialogProvider>
    </NNotificationProvider>
  </NMessageProvider>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePagesStore } from './stores/pages'
import type { Page } from './stores/pages'
import { uiLogger } from '@/utils/logger'
import PageList from './components/page-list/PageList.vue'
import Preview from './components/preview/Preview.vue'
import PageViewer from './components/page-viewer/PageViewer.vue'
import AppHeader from './components/common/AppHeader.vue'
import EmptyState from './components/common/EmptyState.vue'
import { NLayout, NLayoutSider, NButton, NIcon, NTooltip, createDiscreteApi, NMessageProvider, NDialogProvider, NNotificationProvider } from 'naive-ui'
import { ChevronForwardOutline, ChevronBackOutline } from '@vicons/ionicons5'
import { ocrEvents } from '@/services/ocr/events'
import { ocrService } from '@/services/ocr'
import { queueManager } from '@/services/queue'
import { useHealthStore } from '@/stores/health'


const { t } = useI18n()
const pagesStore = usePagesStore()
const { message, dialog } = createDiscreteApi(['message', 'dialog'], {
  configProviderProps: {},
  messageProviderProps: {
    placement: 'bottom-left'
  }
})

// Collapse state management
const pageListCollapsed = ref(false)
const pageViewerCollapsed = ref(false)
const previewCollapsed = ref(false)

// Computed widths for proper space distribution
const pageViewerWidth = computed(() => {
  if (pageViewerCollapsed.value) return '0'
  if (previewCollapsed.value) return 'calc(100% - 32px)' // Reserve space for right-edge-trigger
  return '50%'
})

const previewWidth = computed(() => {
  if (previewCollapsed.value) return '0'
  if (pageViewerCollapsed.value) return '100%'
  return '50%'
})

const selectedPageId = ref<string | null>(null)
const currentPage = computed(() =>
  pagesStore.pages.find(p => p.id === selectedPageId.value) || null
)

function handlePageSelected(page: Page) {
  // Get current selection state
  const wasSelected = pagesStore.selectedPageIds.includes(page.id)

  // Clear all other page selections, but keep the clicked page's selection if it was already selected
  if (wasSelected) {
    // If the clicked page was already selected, keep only this page selected
    pagesStore.selectedPageIds = [page.id]
  } else {
    // If the clicked page was not selected, clear all selections
    pagesStore.clearSelection()
  }

  selectedPageId.value = page.id
}


// Handle page deletion (unified with batch deletion)
async function handlePageDeleted(page: Page) {
  await handleDeletion([page])
}

// Handle batch deletion
async function handleBatchDeleted(pages: Page[]) {
  await handleDeletion(pages)
}

// Unified deletion handler for both single and batch operations
async function handleDeletion(pagesToDelete: Page[]) {
  const isSingle = pagesToDelete.length === 1

  // Check for processing pages
  const processingPages = pagesToDelete.filter(p =>
    p.status === 'recognizing' ||
    p.status === 'pending_ocr' ||
    p.status === 'generating_markdown' ||
    p.status === 'generating_pdf' ||
    p.status === 'generating_docx'
  )

  let content = isSingle
    ? t('app.deleteConfirmSingle', [pagesToDelete[0]!.fileName])
    : t('app.deleteConfirmMultiple', [pagesToDelete.length])

  if (processingPages.length > 0) {
    content += `\n\n⚠️ ${t('app.deleteProcessingWarning', [processingPages.length])}`
  }

  dialog.warning({
    title: t('app.deleteConfirmTitle'),
    content,
    positiveText: t('app.deletePositive'),
    negativeText: t('app.deleteNegative'),
    class: 'delete-confirm-dialog',
    onPositiveClick: async () => {
      try {
        await executeDeletion(pagesToDelete, isSingle, processingPages)
      } catch (error) {
        uiLogger.error('Delete failed:', error)
        message.error(isSingle ? 'Failed to delete page' : 'Failed to delete pages')
      }
    }
  })
}

async function executeDeletion(pagesToDelete: Page[], isSingle: boolean, processingPages: Page[]) {
  const pageIds = pagesToDelete.map(page => page.id)

  // Cancel running tasks first
  if (processingPages.length > 0) {
    await pagesStore.cancelOCRTasks(processingPages.map(p => p.id))
  }

  // Calculate next selection BEFORE deletion to avoid watcher race conditions
  const nextSelectedId = calculateNextSelection(pagesToDelete, pageIds)

  // Delete pages from store
  const deletedResult = pagesStore.deletePages(pageIds)

  if (deletedResult) {
    // Delete from database using batch operation
    await pagesStore.deletePagesFromDB(pageIds)

    // Create appropriate message
    const successMsg = isSingle
      ? t('app.pageDeleted', [pagesToDelete[0]!.fileName])
      : t('app.pagesDeleted', [pagesToDelete.length])

    // Show success message using Naive UI message
    message.success(successMsg)

    // Apply pre-calculated selection
    applyNextSelection(nextSelectedId, pageIds)
  }
}

function calculateNextSelection(pagesToDelete: Page[], pageIds: string[]): string | null {
  if (currentPage.value && pageIds.includes(currentPage.value.id)) {
    const deletedSelectedPage = pagesToDelete.find(p => p.id === currentPage.value!.id)
    if (deletedSelectedPage) {
      const remainingPages = pagesStore.pages.filter(p => !pageIds.includes(p.id))
      const nextCandidates = remainingPages.filter(p => p.order > deletedSelectedPage.order)
      const prevCandidates = remainingPages.filter(p => p.order < deletedSelectedPage.order)

      if (nextCandidates.length > 0) {
        return nextCandidates[0]!.id
      } else if (prevCandidates.length > 0) {
        return prevCandidates[prevCandidates.length - 1]!.id
      }
    }
  }
  return null
}

function applyNextSelection(nextSelectedId: string | null, deletedPageIds: string[]) {
  if (nextSelectedId) {
    handlePageSelected(pagesStore.pages.find(p => p.id === nextSelectedId)!)
  } else if (currentPage.value && deletedPageIds.includes(currentPage.value.id)) {
    // Fallback if we couldn't find next/prev but current is gone
    if (pagesStore.pages.length > 0) {
      handlePageSelected(pagesStore.pages[0]!)
    } else {
      selectedPageId.value = null
      pagesStore.clearSelection()
    }
  }
}


// Handle file add
async function handleFileAdd() {
  console.log('[App] handleFileAdd clicked');
  try {
    const result = await pagesStore.addFiles()
    console.log('[App] addFiles result:', result);

    if (result.success && result.pages.length > 0) {
      // Update current file name to show the first added file
      const firstPage = result.pages[0]
      if (firstPage) {
        // Select the first added page
        handlePageSelected(firstPage)
      }
    } else if (result.error) {
      uiLogger.error('Add error:', result.error)
      // Handle different error cases
      if (result.error === 'No files selected') {
        // Silent handling for cancelled file selection - no message needed
        return
      } else {
        // Show Naive UI error message for other errors (like unsupported file types)
        message.error(result.error)
      }
    }
  } catch (error) {
    uiLogger.error('Add failed:', error)
    message.error(t('app.addFailed'))
  }
}

// Handle drag and drop
async function handleDrop(event: DragEvent) {
  event.preventDefault()
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length > 0) {
    const result = await pagesStore.addFiles(files)
    if (result.success && result.pages.length > 0) {
      const firstPage = result.pages[0]
      if (firstPage) {
        handlePageSelected(firstPage)
      }
    }
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
}


// Watch for changes in existing pages to keep selection valid
// If the selected page is removed or ID changes (unlikely), reset selection
watch(() => pagesStore.pages, (newPages) => {
  if (selectedPageId.value && !newPages.find(p => p.id === selectedPageId.value)) {
    // If selected page is gone, select the first available page or null
    selectedPageId.value = newPages[0]?.id || null
  }
  // Removed auto-selection of first page when none selected - this is handled by onMounted
  // to avoid race condition and double-triggering during initialization
}, { deep: true })

// Store resume timer ID to clear it on unmount
let resumeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Issue #47: background tabs get throttled/frozen and may drop the OCR request.
 * When the tab is visible again, wake parked tasks, refresh health and re-queue orphaned pages.
 */
function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  ocrService.resumeOnVisible(pagesStore.pages).catch(error => {
    uiLogger.error('Failed to resume OCR after tab became visible:', error)
  })
}

// Load pages from database on mount and resume PDF processing
onMounted(async () => {
  // Start health check
  const healthStore = useHealthStore()
  healthStore.startHealthCheck()

  await pagesStore.loadPagesFromDB()
  
  // Resume any interrupted OCR tasks with a delay to avoid server concurrency issues
  resumeTimer = setTimeout(async () => {
    await ocrService.resumeBatchOCR(pagesStore.pages)
    resumeTimer = null
  }, 500)

  if (pagesStore.pages.length > 0 && !selectedPageId.value) {
    const firstPage = pagesStore.pages[0]
    if (firstPage) {
      // Use handlePageSelected to ensure proper initialization
      handlePageSelected(firstPage)
    }
  }

  // Initialize event listeners for OCR and Document Generation
  pagesStore.setupOCREventListeners()
  pagesStore.setupDocGenEventListeners()

  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Add global error notifications for OCR and DocGen
  ocrEvents.on('ocr:error', ({ pageId, error }) => {
    // Skip toast only for the client-side pre-check rejections (OCRService.queueOCR), which the
    // components already show as dialogs. Backend errors are prefixed "OCR API Error:" and must be
    // shown even if the backend message contains "unavailable" (issue #39).
    const errorMsg = error?.message || 'Unknown error'
    const lower = errorMsg.toLowerCase()
    const isApiError = errorMsg.startsWith('OCR API Error:')
    if (!isApiError && (lower.includes('unavailable') || lower.includes('queue is full'))) {
      return
    }

    const page = pagesStore.pages.find(p => p.id === pageId)
    const name = page ? page.fileName : pageId
    // 注意: Naive UI 的 message API 不支持 class 选项
    message.error(`${t('ocr.ocrFailed', [errorMsg])} (${name})`)
  })

  ocrEvents.on('doc:gen:error', ({ pageId, type: _type, error }) => {
    const page = pagesStore.pages.find(p => p.id === pageId)
    const name = page ? page.fileName : pageId
    const errorMsg = error?.message || 'Unknown error'
    message.error(`${t('errors.failedToLoadMarkdown')}: ${errorMsg} (${name})`)
  })

  // Resume any interrupted PDF processing
  try {
    const { pdfService } = await import('./services/pdf')
    await pdfService.resumeProcessing()
  } catch (error) {
    uiLogger.error('Error resuming PDF processing:', error)
  }

  // Expose store for E2E testing observability
  if (typeof window !== 'undefined') {
    (window as unknown as { pagesStore: typeof pagesStore }).pagesStore = pagesStore
    
    // Handle page refresh/close - this is critical for cleaning up queues
    window.addEventListener('beforeunload', () => {
      if (resumeTimer !== null) {
        clearTimeout(resumeTimer)
      }
      queueManager.clear()
    })
  }
})

// Clean up on normal component unmount (SPA navigation, not page refresh)
onBeforeUnmount(() => {
  // Stop health check
  const healthStore = useHealthStore()
  healthStore.stopHealthCheck()
  
  if (resumeTimer !== null) {
    clearTimeout(resumeTimer)
  }
  
  document.removeEventListener('visibilitychange', handleVisibilityChange)

  // Clear queues (note: this won't fire on page refresh, see beforeunload listener above)
  queueManager.clear()
})
</script>

<style>
/* ====== Base ====== */
* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  font-family: Inter, system-ui, sans-serif;
  background: #f6f7f8;
  color: #111;
  height: 100%;
  overflow: hidden;
  /* Theme Variables */
  --primary-color: #18a058;
}


/* ====== Naive UI Overrides ====== */
.n-layout,
.n-layout-header,
.n-layout-sider,
.n-layout-content {
  background-color: #f6f7f8 !important;
}

/* Page List Sider - custom border */
.page-list-sider {
  border-right: 1px solid #e0e0e0 !important;
}

/* Page List Collapse Trigger - positioned at sider edge */
.sider-trigger-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  flex-shrink: 0;
  background: #f6f7f8;
  border-right: 1px solid #e0e0e0;
}

.sider-trigger-btn {
  background: white !important;
  border: 1px solid #d0d0d0 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  width: 28px !important;
  height: 28px !important;
  padding: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: all 0.2s;
}

.sider-trigger-btn:hover {
  border-color: var(--primary-color) !important;
  box-shadow: 0 2px 6px rgba(24, 160, 88, 0.2); /* Need to figure out how to handle rgba with var. Keeping hardcoded for shadow or using color-mix capability if supported, OR just keeping it approximate. For now, replacing border-color. */
}

/* Note on shadow: rgba(24, 160, 88, 0.2) corresponds to primary color opacity 0.2. 
   Ideally we'd use color-mix or similar, but for simplicity/safety we might leave the shadow hardcoded or use a slightly different approach. 
   However, since the user asked for variable, let's just stick to hex/var replacements where explicit.
   Actually, I can use `color-mix(in srgb, var(--primary-color), transparent 80%)` if browser support allows, but that might be risky.
   Let's keep the shadow hardcoded for now or skip it? No, keep it as is or update if requested. 
   Wait, I should probably try to be consistent. 
   Let's just change the border-color for now as that was the main one grepped.
*/

.sider-trigger-btn .n-icon {
  font-size: 18px !important;
}

/* ====== Layout ====== */
.app-container {
  height: 100vh;
}

.app-header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.app-main {
  height: calc(100vh - 64px);
}

.page-list-container {
  padding: 0;
  height: 100%;
}

.preview-container {
  padding: 16px;
  height: 100%;
}

.page-viewer-container {
  height: 100%;
}

/* Content area with panels */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: row; /* Key: horizontal layout */
  height: 100%;
  overflow: hidden;
  position: relative; /* For absolute positioned expand triggers */
}

.panel {
  height: 100%;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-shrink: 0; /* Prevent shrinking below specified width */
}

/* Panel divider with collapse/expand controls */
.panel-divider {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 32px;
  min-width: 32px;
  height: 100%;
  background: #f6f7f8;
  border-left: 1px solid #e0e0e0;
  border-right: 1px solid #e0e0e0;
  gap: 12px;
  flex-shrink: 0;
}

.panel-divider .n-button {
  background: white !important;
  border: 1px solid #d0d0d0 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  opacity: 0.8;
  transition: all 0.2s;
}

.panel-divider .n-button:hover {
  opacity: 1;
  border-color: var(--primary-color) !important;
  box-shadow: 0 2px 6px rgba(24, 160, 88, 0.2);
}

/* Right edge trigger for Preview expand - now part of flex layout */
.right-edge-trigger {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 32px;
  min-width: 32px; /* Prevent shrinking */
  flex-shrink: 0;
  background: #f6f7f8;
  border-left: 1px solid #e0e0e0;
}

.right-edge-trigger .n-button {
  background: white !important;
  border: 1px solid #d0d0d0 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  opacity: 0.8;
  transition: all 0.2s;
}

/* ====== Loading State (Matches index.html) ====== */
.app-loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: #f6f7f8;
}

.app-loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(24, 160, 88, 0.2);
  border-left-color: #18a058;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.app-loading-text {
  color: #666;
  font-size: 14px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.right-edge-trigger .n-button:hover {
  opacity: 1;
  border-color: var(--primary-color) !important;
  box-shadow: 0 2px 6px rgba(24, 160, 88, 0.2);
}
</style>

