<template>
  <div class="preview">
    <div class="preview-header">
      <NTabs
        v-model:value="currentView"
        type="segment"
        animated
        class="preview-tabs"
      >
        <NTabPane
          v-for="view in views"
          :key="view.key"
          :name="view.key"
        >
          <template #tab>
            <div class="tab-label">
              <NIcon
                size="18"
                :color="view.color"
              >
                <component :is="view.icon" />
              </NIcon>
              <span>{{ view.label }}</span>
            </div>
          </template>
        </NTabPane>
      </NTabs>
      <div
        v-if="currentView !== 'md'"
        class="header-actions"
      >
        <!-- Generic download button for binary outputs -->
        <NButton
          size="large"
          text
          :disabled="isBinaryLoading || !hasBinary"
          :aria-label="$t('preview.download', [currentView === 'docx' ? 'DOCX' : 'PDF'])"
          :title="$t('preview.download', [currentView === 'docx' ? 'DOCX' : 'PDF'])"
          @click="downloadBinary(currentView)"
          @mouseenter="isHeaderDownloadHovered = true"
          @mouseleave="isHeaderDownloadHovered = false"
        >
          <template #icon>
            <NIcon :color="PRIMARY_COLOR">
              <Download v-if="isHeaderDownloadHovered" />
              <DownloadOutline v-else />
            </NIcon>
          </template>
        </NButton>
      </div>
      <div
        v-if="currentView === 'md'"
        class="header-actions"
      >
        <!-- Copy Source Button -->
        <NButton
          size="small"
          text
          :disabled="!mdContent || isLoadingMd"
          :title="t('preview.copy')"
          @click="handleCopyMarkdown"
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
        <NButton
          size="large"
          text
          :disabled="!mdContent || isLoadingMd"
          :aria-label="$t('preview.downloadMD')"
          :title="$t('preview.downloadMD')"
          @click="handleDownloadMarkdown"
          @mouseenter="isHeaderDownloadHovered = true"
          @mouseleave="isHeaderDownloadHovered = false"
        >
          <template #icon>
            <NIcon :color="PRIMARY_COLOR">
              <Download v-if="isHeaderDownloadHovered" />
              <DownloadOutline v-else />
            </NIcon>
          </template>
        </NButton>
        <NSwitch
          v-model:value="mdViewMode"
          size="small"
          :title="mdViewMode ? $t('preview.showSource') : $t('preview.showPreview')"
        >
          <template #checked-icon>
            <NIcon :component="Eye" />
          </template>
          <template #unchecked-icon>
            <NIcon :component="CodeSlash" />
          </template>
        </NSwitch>
      </div>
    </div>

    <div class="preview-content">
      <!-- Markdown View -->
      <div
        v-if="currentView === 'md'"
        class="markdown-wrapper"
      >
        <NSpin
          v-if="isLoadingMd"
          :description="$t('preview.loadingMarkdown')"
        />
        <template v-else>
          <div
            v-if="mdViewMode"
            class="markdown-render-area markdown-body"
            v-html="renderedMd"
          />
          <pre
            v-else
            class="markdown-preview"
          >{{ mdContent || $t('preview.noMarkdown') }}</pre>
        </template>
      </div>

      <!-- Word (DOCX) View -->
      <div
        v-else-if="currentView === 'docx'"
        class="docx-wrapper"
      >
        <NSpin
          v-if="isBinaryLoading"
          :description="$t('preview.loadingDOCX')"
        />
        <NEmpty
          v-else-if="!hasBinary"
          :description="$t('preview.docxNotReady')"
        />
        <div
          v-else
          class="docx-render-area"
        >
          <div
            ref="wordPreviewContainer"
            class="word-container"
            :class="{ 'spacing-zh': isChineseDominant }"
          />
        </div>
      </div>

      <!-- PDF View -->
      <div
        v-else-if="currentView === 'pdf'"
        class="binary-preview"
      >
        <NSpin
          v-if="isBinaryLoading"
          :description="$t('preview.checkingPDF')"
        />
        <NEmpty
          v-else-if="!hasBinary"
          :description="$t('preview.pdfNotReady')"
        />
        <div
          v-else
          class="pdf-container"
        >
          <iframe 
            v-if="pdfPreviewUrl" 
            :src="pdfPreviewUrl" 
            type="application/pdf"
            width="100%" 
            height="100%" 
            title="PDF Preview"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTabs, NTabPane, NEmpty, NButton, NSpin, NSwitch, NIcon, useMessage } from 'naive-ui'
import { Eye, CodeSlash, DownloadOutline, Download, Copy, CopyOutline, Checkmark } from '@vicons/ionicons5'
import IconMarkdown from '@/components/icons/IconMarkdown.vue'
import IconWord from '@/components/icons/IconWord.vue'
import IconPDF from '@/components/icons/IconPDF.vue'
import { renderAsync } from 'docx-preview'
import MarkdownIt from 'markdown-it'
// @ts-expect-error -- @iktakahiro/markdown-it-katex does not have type definitions currently
import MarkdownItKatex from '@iktakahiro/markdown-it-katex'
import 'katex/dist/katex.min.css'
import { db } from '@/db'
import { uiLogger } from '@/utils/logger'
import { sanitizeRenderedHtml } from '@/utils/sanitize-html'
import 'github-markdown-css/github-markdown.css'
import { exportService } from '@/services/export'
import { PRIMARY_COLOR } from '@/theme/vars'

import type { Page } from '@/stores/pages'

const { t } = useI18n()
const message = useMessage()

// Props
const props = defineProps<{
  currentPage: Page | null
}>()

// State
const currentView = ref<'md' | 'docx' | 'pdf'>('md')
const mdContent = ref<string>('')
const isLoadingMd = ref(false)
const isBinaryLoading = ref(false)
const hasBinary = ref(false)
const wordPreviewContainer = ref<HTMLElement | null>(null)
const docxBlob = ref<Blob | null>(null)
const mdViewMode = ref<boolean>(true) // true for preview, false for source
const isHeaderDownloadHovered = ref(false)
const isCopyHovered = ref(false)
const isCopied = ref(false)
const renderedMd = ref<string>('')

async function handleCopyMarkdown() {
  if (!mdContent.value || isCopied.value) return

  try {
    await navigator.clipboard.writeText(mdContent.value)
    // message.success(t('preview.copied')) -- Removed per request
    isCopied.value = true
    setTimeout(() => {
        isCopied.value = false
    }, 2000)
  } catch (err) {
    uiLogger.error('Copy markdown failed', err)
    message.error(t('ocrRawTextPanel.copyFailed'))
  }
}


const mdRenderer = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
})
mdRenderer.use(MarkdownItKatex)

// All markdown bound via v-html must go through here: html:true lets OCR output
// inject raw tags, so the rendered HTML is sanitized (see sanitize-html.ts).
const renderMarkdownSafe = (markdown: string): string =>
    sanitizeRenderedHtml(mdRenderer.render(markdown))



const isChineseDominant = computed(() => {
    // 优先使用 Markdown 内容检测，如果没有则回退到 OCR 文本
    const text = mdContent.value || props.currentPage?.ocrText || ''
    /* eslint-disable sonarjs/slow-regex */
    const cleanText = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
                          .replace(/\[[^\]]*\]\([^)]*\)/g, '')
                          .replace(/[#*`~>+\-=_]/g, '')
    /* eslint-enable sonarjs/slow-regex */
    
    const totalLength = cleanText.length
    if (totalLength === 0) return false

    const chineseMatches = cleanText.match(/[\u4e00-\u9fa5]/g)
    const chineseCount = chineseMatches ? chineseMatches.length : 0

    return (chineseCount / totalLength) > 0.1 // 降低阈值到 10%，更敏感
})

// Custom render rule or post-process for scan2doc-img:
// We'll use a simple regex replacement for now as it's efficient for this use case
const fetchAndCreateImageUrl = async (imageId: string): Promise<string | null> => {
    try {
        const image = await db.getPageExtractedImage(imageId)
        if (!image) return null
        
        const blob = image.blob instanceof Blob 
            ? image.blob 
            : new Blob([image.blob], { type: 'image/png' })
            
        const url = URL.createObjectURL(blob)
        previewObjectUrls.push(url)
        return url
    } catch (e) {
        uiLogger.error('Failed to load image for MD preview', imageId, e)
        return null
    }
}

const processMdSyntaxImages = async (markdown: string): Promise<string> => {
    let processed = markdown
    const mdRegex = /!\[(.*?)\]\(scan2doc-img:([a-zA-Z0-9_-]+)\)/g
    
    // We use a separate string for regex matching to avoid issues with processed replacements
    const matches = Array.from(markdown.matchAll(mdRegex))
    for (const m of matches) {
        const [fullMatch, alt, imageId] = m
        if (imageId) {
            const url = await fetchAndCreateImageUrl(imageId)
            if (url) {
                processed = processed.replace(fullMatch, `![${alt}](${url})`)
            }
        }
    }
    return processed
}

const processHtmlImgImages = async (markdown: string): Promise<string> => {
    let processed = markdown
    const htmlRegex = /<img\s+src="scan2doc-img:([a-zA-Z0-9_-]+)"([^>]*)>/g
    
    const matches = Array.from(markdown.matchAll(htmlRegex))
    for (const m of matches) {
        const [fullMatch, imageId, otherAttrs] = m
        if (imageId) {
            const url = await fetchAndCreateImageUrl(imageId)
            if (url) {
                processed = processed.replace(fullMatch, `<img src="${url}"${otherAttrs}>`)
            }
        }
    }
    return processed
}

// Custom render rule or post-process for scan2doc-img:
// We'll use a simple regex replacement for now as it's efficient for this use case
const processMarkdownImages = async (markdown: string): Promise<string> => {
    let processed = await processMdSyntaxImages(markdown)
    processed = await processHtmlImgImages(processed)
    return processed
}
const previewObjectUrls: string[] = []

const views = computed(() => [
  { key: 'md' as const, label: t('preview.markdown'), icon: IconMarkdown, color: '#24292e' },
  { key: 'docx' as const, label: t('preview.word'), icon: IconWord, color: '#2b579a' },
  { key: 'pdf' as const, label: t('preview.pdf'), icon: IconPDF, color: '#b30b00' }
])

const pdfPreviewUrl = ref<string>('')

// Watch for page change or status change or view change
watch(
  [() => props.currentPage?.id, () => props.currentPage?.status, currentView],
  async ([newPageId, newStatus, newView], [oldPageId, oldStatus, oldView]) => {
    await handlePreviewUpdate(newPageId, newStatus, newView, oldPageId, oldStatus, oldView)
  },
  { immediate: true }
)

async function handlePreviewUpdate(
    newPageId: string | undefined, 
    newStatus: string | undefined, 
    newView: string,
    oldPageId: string | undefined,
    oldStatus: string | undefined,
    oldView: string | undefined
) {
    if (!newPageId) {
       resetPreviewState()
       return
    }

    const isChanged = newPageId !== oldPageId || newStatus !== oldStatus
    await performViewUpdate(newPageId, newView, oldView, isChanged)
}

async function performViewUpdate(
    pageId: string, 
    newView: string, 
    oldView: string | undefined, 
    isChanged: boolean
) {
    if (newView === 'md') {
        if (isChanged || oldView !== 'md') {
            await loadMarkdown(pageId)
        }
    } else if (newView === 'docx' || newView === 'pdf') {
        if (isChanged || oldView !== newView) {
            await checkBinaryStatus(pageId, newView)
        }
    }
}

function resetPreviewState() {
    mdContent.value = ''
    hasBinary.value = false
    cleanupPdfUrl()
}

function cleanupPdfUrl() {
    if (pdfPreviewUrl.value) {
        URL.revokeObjectURL(pdfPreviewUrl.value)
        pdfPreviewUrl.value = ''
    }
}

async function checkBinaryStatus(pageId: string, type: 'docx' | 'pdf') {
    isBinaryLoading.value = true
    docxBlob.value = null
    
    // Cleanup previous PDF URL if switching away or reloading
    if (pdfPreviewUrl.value) {
        URL.revokeObjectURL(pdfPreviewUrl.value)
        pdfPreviewUrl.value = ''
    }
    
    // Pre-load Markdown content for language detection even in DOCX/PDF view
    // This ensures isChineseDominant is computed correctly when switching pages
    // Always reload to handle page switching correctly
    try {
        mdContent.value = '' // Clear first to trigger reactivity
        const record = await db.getPageMarkdown(pageId)
        if (record) {
            mdContent.value = record.content
        }
    } catch (e) {
        uiLogger.warn('[Preview] Could not pre-load markdown for language detection', e)
    }

    try {
        const blob = type === 'docx' 
            ? await db.getPageDOCX(pageId) 
            : await db.getPagePDF(pageId)
        
        hasBinary.value = !!blob
        
        if (blob) {
            if (type === 'docx') {
                docxBlob.value = blob
                // Using a small delay to ensure DOM is ready and initialized
                setTimeout(async () => {
                    await renderDocx()
                }, 100)
            } else if (type === 'pdf') {
                pdfPreviewUrl.value = URL.createObjectURL(blob)
            }
        }
    } catch (error) {
        uiLogger.error(`Failed to check binary status for ${type}`, error)
        hasBinary.value = false
    } finally {
        isBinaryLoading.value = false
    }
}

async function renderDocx() {
  if (!wordPreviewContainer.value || !docxBlob.value) return
  try {
    // Clear previous content
    wordPreviewContainer.value.innerHTML = ''
    
    // Some environments (like JSDOM in tests) might not have Blob.arrayBuffer()
    const arrayBuffer = await new Response(docxBlob.value).arrayBuffer()
    
    await renderAsync(arrayBuffer, wordPreviewContainer.value, undefined, {
        className: 'docx-preview-output',
        inWrapper: false,
        ignoreHeight: false,
        ignoreWidth: false,
        breakPages: true
    })
    
    // Force override inline styles set by docx-preview
    // CSS cannot override inline styles, so we must use JavaScript
    applyPreviewStyleOverrides()
    
  } catch (error) {
    uiLogger.error('[Preview] Failed to render DOCX', error)
  }
}

/**
 * Force override inline styles set by docx-preview.
 * This is necessary because docx-preview injects inline `style` attributes
 * which have higher priority than any CSS selector (even with !important).
 */
function applyPreviewStyleOverrides() {
    if (!wordPreviewContainer.value) return
    
    const isChinese = isChineseDominant.value
    // Use a larger line-height value to make the effect more visible
    // 1.5 might not be visually distinct enough for Chinese fonts
    const lineHeight = '2.0'  // Increased from 1.5 for testing
    const textIndent = isChinese ? '2em' : '0'
    const marginBottom = isChinese ? '0' : '24px'
    
    // Helper to check if element is inside a table
    const isInsideTable = (el: Element): boolean => el.closest('table') !== null

    // Helper to force set important styles
    const forceStyle = (el: HTMLElement, prop: string, value: string) => {
        el.style.setProperty(prop, value, 'important')
    }
    
    // First, set line-height on the container itself
    const container = wordPreviewContainer.value.querySelector('.docx-preview-output') as HTMLElement
    if (container) {
        forceStyle(container, 'line-height', lineHeight)
    }
    
    // AGGRESSIVE: Override ALL elements within the preview
    const allElements = wordPreviewContainer.value.querySelectorAll('.docx-preview-output *')
    allElements.forEach((element: Element) => {
        if (isInsideTable(element)) return
        forceStyle(element as HTMLElement, 'line-height', lineHeight)
    })
    
    // Override paragraph-like elements with indent and margin
    const paragraphs = wordPreviewContainer.value.querySelectorAll('.docx-preview-output p, .docx-preview-output [class*="paragraph"]')
    paragraphs.forEach((p: Element) => {
        if (isInsideTable(p)) return
        const el = p as HTMLElement
        forceStyle(el, 'text-indent', textIndent)
        forceStyle(el, 'margin-bottom', marginBottom)
        forceStyle(el, 'margin-top', '0')
    })
    
    // Headings should not be indented
    const headings = wordPreviewContainer.value.querySelectorAll('.docx-preview-output h1, .docx-preview-output h2, .docx-preview-output h3, .docx-preview-output h4, .docx-preview-output [class*="heading"]')
    headings.forEach((h: Element) => {
        if (isInsideTable(h)) return
        const el = h as HTMLElement
        forceStyle(el, 'text-indent', '0')
        forceStyle(el, 'margin-bottom', isChinese ? '0.5em' : '1em')
        forceStyle(el, 'margin-top', '1em')
    })
}

async function loadMarkdown(pageId: string) {
    isLoadingMd.value = true
    try {
        const record = await db.getPageMarkdown(pageId)
        if (record) {
            mdContent.value = record.content
            // 2. Process images
            const processedMd = await processMarkdownImages(record.content)
            renderedMd.value = renderMarkdownSafe(processedMd)
        } else {
             // Fallback to OCR text if no markdown yet, but avoid showing JSON (e.g. from Find mode)
             const raw = props.currentPage?.ocrText || ''
             const isJson = raw.trim().startsWith('{') || raw.trim().startsWith('[') || raw.includes('<|det|>') // Also check for raw tags if any
             
             if (!isJson) {
                mdContent.value = raw
                renderedMd.value = renderMarkdownSafe(mdContent.value)
             } else {
                mdContent.value = '' // Don't show confusing raw data in Preview
                renderedMd.value = '' 
             }
        }
    } catch (error) {
        uiLogger.error('Failed to load markdown', error)
        mdContent.value = t('preview.failedToLoad')
    } finally {
        isLoadingMd.value = false
    }
}

async function handleDownloadMarkdown() {
    if (!mdContent.value || !props.currentPage) return
    
    try {
        // Use ExportService to handle image replacement
        // props.currentPage is of type Page, which matches exportToMarkdown's first argument type (Page[])
        const result = await exportService.exportToMarkdown(
            [props.currentPage],
            { format: 'markdown', includeImages: true }
        )
        
        // Download the result
        exportService.downloadBlob(result)
    } catch (error) {
        uiLogger.error('Failed to export markdown', error)
    }
}

async function downloadBinary(type: 'docx' | 'pdf' | 'md') {
    if (type === 'md') {
        handleDownloadMarkdown()
        return
    }

    if (!props.currentPage) return
    const pageId = props.currentPage.id!
    
    try {
        const blob = type === 'docx' 
            ? await db.getPageDOCX(pageId) 
            : await db.getPagePDF(pageId)
            
        if (!blob) return

        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const baseName = props.currentPage.fileName.replace(/\.[^/.]+$/, "")
        const ext = type === 'docx' ? 'docx' : 'pdf'
        a.download = `${baseName}.${ext}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    } catch (error) {
        uiLogger.error(`Failed to download ${type}`, error)
    }
}

onUnmounted(() => {
  // Cleanup MD preview images
  previewObjectUrls.forEach(url => URL.revokeObjectURL(url))
  previewObjectUrls.length = 0
  
  if (pdfPreviewUrl.value) {
      URL.revokeObjectURL(pdfPreviewUrl.value)
      pdfPreviewUrl.value = ''
  }
})
</script>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.preview-content {
  flex: 1;
  padding: 16px;
  overflow: auto;
  height: 100%;
}

.image-preview {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-wrapper {
  max-width: 100%;
  max-height: 100%;
  display: flex;
  justify-content: center;
}

.preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border-radius: 4px;
}

.markdown-preview {
  font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #374151;
  background: #f9fafb;
  padding: 16px;
  border-radius: 6px;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.binary-preview {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.docx-wrapper {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.docx-render-area {
  flex: 1;
  overflow: auto;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.word-container {
  background: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  min-height: 100%;
  width: 100%;
  max-width: 800px;
}

.docx-footer {
  margin-top: 16px;
  padding-bottom: 20px;
}

/* Deep selector for docx-preview generated content */
:deep(.docx-preview-output) {
  padding: 40px !important;
  background: white !important;
  margin: 0 auto !important;
  /* letter-spacing removed from base class, controlled by .spacing-zh modifier */
}

.download-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px;
  background: #f9fafb;
  border-radius: 12px;
  border: 1px dashed #d1d5db;
}

.file-icon {
  font-size: 64px;
}

.file-name {
  font-weight: 500;
  color: #374151;
  font-size: 16px;
}

.markdown-render-area {
  padding: 24px;
  background: white;
  border-radius: 6px;
  /* Minimal github-like styles */
  font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: #24292f;
}

:deep(.markdown-render-area table:not(.layout-table)) {
  border-collapse: collapse !important;
  margin-bottom: 1rem !important;
  border: 1px solid #d1d5db !important;
  background-color: #ffffff !important;
}

:deep(.markdown-render-area table:not(.layout-table) th),
:deep(.markdown-render-area table:not(.layout-table) td) {
  border: 1px solid #d1d5db !important;
  padding: 8px !important;
  color: #1f2937 !important;
  background-color: #ffffff !important;
}

:deep(.markdown-render-area table:not(.layout-table) th),
:deep(.markdown-render-area table:not(.layout-table) tr:first-child td) {
  background-color: #f3f4f6 !important;
  font-weight: 600 !important;
}

:deep(.markdown-render-area table:not(.layout-table) tr:nth-child(even) td) {
  background-color: #f9fafb !important;
}

/* Layout tables (generated for side-by-side content) should have no borders */
:deep(.markdown-render-area table.layout-table) {
  border: none !important;
  border-collapse: collapse !important;
  margin-bottom: 1rem !important;
}

:deep(.markdown-render-area table.layout-table td) {
  border: none !important;
  padding: 0 8px !important;
  vertical-align: top !important;
}

/* Ensure KaTeX superscript layout is not messed up by global resets */
:deep(.katex) {
  line-height: 1.2;
  white-space: nowrap;
}

.pdf-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.pdf-container iframe {
    flex: 1;
    border: none;
    background: #525659; /* Standard PDF viewer background color */
}

.pdf-footer {
    padding: 8px;
    background: #fff;
    border-top: 1px solid #eee;
    display: flex;
    justify-content: flex-end;
}

/* Force borders for docx-preview output */
:deep(.docx-preview-output table) {
  border: 1px solid black !important;
  border-collapse: collapse !important;
  margin-bottom: 16px !important;
}

:deep(.docx-preview-output td),
:deep(.docx-preview-output th) {
  border: 1px solid black !important;
}

/*
 * NOTE: docx-preview uses inline styles that cannot be overridden by CSS.
 * All text formatting (line-height, text-indent, margin) is handled by
 * JavaScript in applyPreviewStyleOverrides() after rendering.
 * The CSS rules below only set font properties which are NOT overridden inline.
 */

/* Font styling for Chinese content */
.word-container.spacing-zh :deep(.docx-preview-output) {
    letter-spacing: 1px !important;
    font-family: "Microsoft YaHei" !important;
}

/* Font styling for English content */
.word-container:not(.spacing-zh) :deep(.docx-preview-output) {
    letter-spacing: normal !important;
    font-family: Arial, sans-serif !important;
}
.preview-toggle {
  display: flex;
  align-items: center;
}

.copy-section {
  display: flex;
  align-items: center;
  margin-left: 8px;
  margin-right: 8px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 16px;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 8px;
}


</style>