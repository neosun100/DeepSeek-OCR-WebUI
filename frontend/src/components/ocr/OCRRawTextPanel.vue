<template>
  <div class="ocr-raw-text-panel">
    <div
      class="panel-header"
      @click="expanded = !expanded"
    >
      <div class="title-row">
        <NIcon :class="{ rotated: expanded }">
          <ChevronForward />
        </NIcon>
        <span class="panel-title">{{ t('ocrRawTextPanel.title') }}</span>
      </div>
      <NButton
        size="small"
        text
        circle
        :title="t('ocrRawTextPanel.copy')"
        @click.stop="handleCopy"
        @mouseenter="isCopyHovered = true"
        @mouseleave="isCopyHovered = false"
      >
        <template #icon>
          <NIcon :color="PRIMARY_COLOR">
            <Checkmark v-if="isCopied" />
            <template v-else>
              <Copy v-if="isCopyHovered" />
              <CopyOutline v-else />
            </template>
          </NIcon>
        </template>
      </NButton>
    </div>

    <NCollapseTransition :show="expanded">
      <div
        v-if="finishReason || warningList.length > 0"
        class="output-checks"
        data-testid="raw-text-output-checks"
      >
        <div
          v-if="finishReason"
          class="finish-reason"
          data-testid="raw-text-finish-reason"
          :data-reason="finishReason"
        >
          <span class="check-label">{{ t('ocrRawTextPanel.finishReason') }}:</span>
          {{ finishReasonText }}
        </div>
        <div
          v-if="warningList.length > 0"
          class="warning-list"
        >
          <span class="check-label">{{ t('ocrRawTextPanel.warnings') }}:</span>
          <div
            v-for="w in warningList"
            :key="w.code"
            :class="['warning-item', isFailingWarning(w) ? 'is-failing' : 'is-hint']"
            data-testid="raw-text-warning"
            :data-code="w.code"
          >
            <NTag
              size="tiny"
              :type="isFailingWarning(w) ? 'warning' : 'info'"
              :bordered="false"
            >
              {{ isFailingWarning(w) ? w.code : t('ocrRawTextPanel.hint') }}
            </NTag>
            <span class="warning-message">{{ w.message }}</span>
          </div>
        </div>
      </div>
      <div class="panel-content">
        <NScrollbar
          style="max-height: 200px"
          trigger="hover"
        >
          <pre class="raw-text-content">{{ text || t('ocrRawTextPanel.noText') }}</pre>
        </NScrollbar>
      </div>
    </NCollapseTransition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NIcon, NCollapseTransition, NScrollbar, NTag, useMessage } from 'naive-ui'
import { CopyOutline, Copy, ChevronForward, Checkmark } from '@vicons/ionicons5'
import { uiLogger } from '@/utils/logger'
import { PRIMARY_COLOR } from '@/theme/vars'
import { isFailingWarning, normalizeWarnings, type OCRWarning } from '@/services/ocr/types'

interface Props {
  text: string
  /** v5 output-check warnings; absent for v4 results */
  warnings?: OCRWarning[]
  /** v5 finish_reason: stop | length | repetition_cut */
  finishReason?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  warnings: () => [],
  finishReason: null
})
const { t } = useI18n()

// Failing warnings first, informational hints (near_empty, bbox_invalid) after
const warningList = computed(() => {
  const list = normalizeWarnings(props.warnings)
  return [...list.filter(isFailingWarning), ...list.filter(w => !isFailingWarning(w))]
})

const FINISH_REASON_KEYS: Record<string, string> = {
  stop: 'ocrRawTextPanel.finishStop',
  length: 'ocrRawTextPanel.finishLength',
  repetition_cut: 'ocrRawTextPanel.finishRepetitionCut'
}

const finishReasonText = computed(() => {
  const key = props.finishReason ? FINISH_REASON_KEYS[props.finishReason] : undefined
  return key ? t(key) : (props.finishReason ?? '')
})
const expanded = ref(true)
const message = useMessage()
const isCopyHovered = ref(false)
const isCopied = ref(false)

async function handleCopy() {
  if (!props.text || isCopied.value) return

  try {
    let success = false
    if (navigator.clipboard && navigator.clipboard.writeText) {
       await navigator.clipboard.writeText(props.text)
       success = true
    } else {
       // Fallback for older browsers or non-secure contexts
       const textArea = document.createElement('textarea')
       textArea.value = props.text
       document.body.appendChild(textArea)
       textArea.select()
       try {
         document.execCommand('copy')
         success = true
       } catch (err) {
         uiLogger.error('document.execCommand copy failed', err)
         message.error(t('ocrRawTextPanel.copyFailed'))
       }
       document.body.removeChild(textArea)
    }

    if (success) {
      isCopied.value = true
      setTimeout(() => {
        isCopied.value = false
      }, 2000)
    }
  } catch (err) {
    uiLogger.error('handleCopy failed', err)
    message.error(t('ocrRawTextPanel.copyFailed'))
  }
}
</script>

<style scoped>
.ocr-raw-text-panel {
  border-top: 1px solid var(--n-border-color);
  background: #fff;
  min-width: 0;
  width: 100%;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  background: #fafafa;
  user-select: none;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--n-text-color-2);
}

.title-row .n-icon {
  transition: transform 0.2s;
}

.title-row .n-icon.rotated {
  transform: rotate(90deg);
}

.output-checks {
  padding: 8px 12px;
  border-top: 1px solid var(--n-border-color);
  font-size: 12px;
  line-height: 1.6;
  background: #fffdf5;
}

.check-label {
  font-weight: 500;
  margin-right: 4px;
}

.warning-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}

.warning-item.is-hint {
  opacity: 0.8;
}

.warning-message {
  word-break: break-word;
}

.panel-content {
  padding: 0;
  border-top: 1px solid var(--n-border-color);
}

.raw-text-content {
  margin: 0;
  padding: 20px;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: v-mono, SF Mono, Menlo, Consolas, Courier, monospace;
  font-size: 13px;
  line-height: 1.5;
  color: var(--n-text-color);
  background: #fff;
}
</style>
