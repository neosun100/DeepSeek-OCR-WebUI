<template>
  <NLayoutHeader
    data-testid="app-header"
    class="app-header"
    bordered
  >
    <!-- Left: Branding -->
    <div class="header-brand">
      <NIcon
        size="24"
        :color="PRIMARY_COLOR"
        class="brand-icon"
      >
        <DocumentText />
      </NIcon>
      <span
        class="app-title"
        data-testid="app-title"
      >
        {{ $t('header.scan2Doc') }}
      </span>
      <span
        class="model-badge"
        data-testid="version-badge"
      >{{ APP_VERSION_LABEL }}</span>
    </div>

    <!-- Center: OCR Status & Queue -->
    <div class="header-center">
      <template v-if="store.ocrTaskCount === 0 && !showQueue">
        <OCRHealthIndicator />
      </template>

      <NPopover
        v-if="store.ocrTaskCount > 0 || showQueue"
        v-model:show="showQueue"
        trigger="manual"
        placement="bottom"
        :show-arrow="false"
        raw
      >
        <template #trigger>
          <div
            v-show="store.ocrTaskCount > 0"
            class="status-pill"
            data-testid="ocr-queue-badge"
            @click.stop="showQueue = !showQueue"
          >
            <NSpin
              size="small"
              :stroke-width="20"
              class="status-spinner"
            />
            <span class="status-text">
              {{ $t('header.processing') }}: {{ store.activeOCRTasks.length }} | {{ $t('header.waiting') }}: {{ store.queuedOCRTasks.length }}
            </span>
            <NDivider vertical />
            <OCRHealthIndicator compact />
          </div>
        </template>
        <div ref="popoverContentRef">
          <OCRQueuePopover @close="showQueue = false" />
        </div>
      </NPopover>
    </div>

    <!-- Right: Actions -->
    <div class="header-actions">
      <!-- GitHub Links -->
      <div class="github-links">
        <NTooltip
          trigger="hover"
          :theme-overrides="{ color: PRIMARY_COLOR, textColor: '#fff' }"
        >
          <template #trigger>
            <a
              href="https://github.com/neosun100/DeepSeek-OCR-WebUI"
              target="_blank"
              class="github-btn"
            >
              <NButton
                quaternary
                circle
                size="small"
              >
                <template #icon>
                  <NIcon><LogoGithub /></NIcon>
                </template>
              </NButton>
              <span class="btn-text">Star</span>
            </a>
          </template>
          {{ $t('header.starProject') }}
        </NTooltip>

        <NTooltip
          trigger="hover"
          :theme-overrides="{ color: PRIMARY_COLOR, textColor: '#fff' }"
        >
          <template #trigger>
            <a
              href="https://github.com/neosun100/DeepSeek-OCR-WebUI/issues"
              target="_blank"
              class="github-btn"
            >
              <NButton
                quaternary
                circle
                size="small"
              >
                <template #icon>
                  <NIcon><ChatboxEllipsesOutline /></NIcon>
                </template>
              </NButton>
              <span class="btn-text">Issue</span>
            </a>
          </template>
          {{ $t('header.reportIssue') }}
        </NTooltip>

        <NTooltip
          trigger="hover"
          :theme-overrides="{ color: PRIMARY_COLOR, textColor: '#fff' }"
        >
          <template #trigger>
            <a
              href="https://github.com/neosun100/DeepSeek-OCR-WebUI#readme"
              target="_blank"
              class="github-btn"
            >
              <NButton
                quaternary
                circle
                size="small"
              >
                <template #icon>
                  <NIcon><BookOutline /></NIcon>
                </template>
              </NButton>
              <span class="btn-text">Docs</span>
            </a>
          </template>
          {{ $t('header.readDocs') }}
        </NTooltip>
      </div>

      <NDivider vertical />

      <!-- Language Selector -->
      <LanguageSelector />

      <!-- Primary CTA -->
      <NButton
        type="primary"
        size="medium"
        class="add-btn"
        data-testid="import-files-button"
        @click="handleAddFiles"
      >
        <template #icon>
          <NIcon>
            <CloudUpload />
          </NIcon>
        </template>
        {{ $t('header.importFiles') }}
      </NButton>
    </div>
  </NLayoutHeader>
</template>

<script setup lang="ts">
import { APP_VERSION_LABEL } from '@/version'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { NLayoutHeader, NButton, NIcon, NPopover, NSpin, NDivider, NTooltip } from 'naive-ui'
import { DocumentText, CloudUpload, LogoGithub, ChatboxEllipsesOutline, BookOutline } from '@vicons/ionicons5'
import { usePagesStore } from '@/stores/pages'
import OCRQueuePopover from '@/components/common/OCRQueuePopover.vue'
import OCRHealthIndicator from '@/components/common/OCRHealthIndicator.vue'
import LanguageSelector from '@/components/common/LanguageSelector.vue'
import { PRIMARY_COLOR } from '@/theme/vars'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
defineProps<{}>()

const emit = defineEmits<{
  (e: 'add-files'): void
}>()

useI18n()
const store = usePagesStore()
const showQueue = ref(false)
const popoverContentRef = ref<HTMLElement | null>(null)

// Intelligent Dismissal: Close queue when clicking outside, but ignore:
// 1. The trigger badge itself (handled by its own click)
// 2. Elements with .keep-queue-open class (Scan buttons, Quick Actions)
onClickOutside(popoverContentRef, () => {
  showQueue.value = false
}, {
  ignore: [
    '.keep-queue-open', 
    '[data-testid="ocr-queue-badge"]',
    '[data-testid="ocr-trigger-btn"]',
    '[data-testid="ocr-mode-dropdown"]',
    '[data-testid="ocr-actions-container"]',
    '.ocr-actions',
    '.ocr-mode-selector'
  ]
})

const handleAddFiles = () => {
  emit('add-files')
}

defineExpose({
  showQueue,
  handleAddFiles
})
</script>

<style scoped>
.app-header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background-color: #f6f7f8;
  position: relative; /* For absolute center positioning */
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  user-select: none;
  z-index: 1;
}

.brand-icon {
  display: flex;
}

.app-title {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  letter-spacing: -0.5px;
}

.model-badge {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #18a058, #0d7a3e);
  padding: 2px 8px;
  border-radius: 10px;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.header-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  z-index: 2;
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 20px;
  padding: 6px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #333;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  transition: all 0.2s;
}

.status-pill:hover {
  background: #fafafa;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
}

.status-spinner {
  --n-size: 14px !important;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 1;
}



.github-links {
  display: flex;
  align-items: center;
  gap: 4px;
}

.github-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 6px;
  color: #555;
  text-decoration: none;
  transition: all 0.2s;
}

.github-btn:hover {
  background: rgba(24, 160, 88, 0.08);
  color: var(--primary-color);
}

.github-text {
  font-size: 13px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .app-header {
    padding: 0 12px;
    height: 56px;
  }

  .app-title {
    font-size: 14px;
    white-space: nowrap;
  }

  .header-center {
    display: none;
  }

  .github-links {
    display: none;
  }

  .header-actions {
    gap: 8px;
  }

  .header-actions .n-divider {
    display: none;
  }

  .add-btn {
    padding: 0 12px;
    font-size: 13px;
  }

  .add-btn .n-button__content {
    gap: 4px;
  }
}

@media (max-width: 480px) {
  .app-header {
    padding: 0 8px;
  }

  .header-brand {
    gap: 8px;
  }

  .app-title {
    font-size: 13px;
  }

  .add-btn span {
    display: none;
  }
}
</style>
