import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PageViewer from './PageViewer.vue'
import { db } from '@/db'
import { uiLogger } from '@/utils/logger'
import { i18n } from '../../../tests/setup'
import { ocrService } from '@/services/ocr'
import { useHealthStore } from '@/stores/health'

import { createTestingPinia } from '@pinia/testing'

// Mock logger
vi.mock('@/utils/logger', () => ({
  uiLogger: {
    info: vi.fn(),
    error: vi.fn()
  },
  queueLogger: {
    info: vi.fn(),
    error: vi.fn()
  },
  storeLogger: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/services/ocr', () => ({
  ocrService: {
    queueOCR: vi.fn()
  }
}))

// Mock Naive UI components
// Hoist mocks for spying
const mocks = vi.hoisted(() => ({
  dialog: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    create: vi.fn()
  },
  message: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  },
  notification: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}))

// Mock Naive UI components
vi.mock('naive-ui', () => ({
  NCard: {
    name: 'NCard',
    props: ['size', 'bordered'],
    template: '<div><slot></slot></div>'
  },
  NSpace: {
    name: 'NSpace',
    props: ['justify', 'align', 'size'],
    template: '<div><slot></slot></div>'
  },
  NButton: {
    name: 'NButton',
    props: ['disabled', 'type', 'loading', 'size', 'quaternary'],
    template: '<button :disabled="disabled"><slot name="icon"></slot><slot></slot></button>'
  },
  NButtonGroup: {
    name: 'NButtonGroup',
    props: ['size'],
    template: '<div><slot></slot></div>'
  },
  NSpin: {
    name: 'NSpin',
    props: ['size'],
    template: '<div><slot name="description"></slot><slot></slot></div>'
  },
  NEmpty: {
    name: 'NEmpty',
    props: ['description'],
    template: '<div><slot name="icon"></slot>{{ description }}</div>'
  },
  NResult: {
    name: 'NResult',
    props: ['status', 'title'],
    template: '<div>{{ title }}</div>'
  },
  NText: {
    name: 'NText',
    props: ['type', 'depth'],
    template: '<span><slot></slot></span>'
  },
  NIcon: {
    name: 'NIcon',
    props: ['size'],
    template: '<span><slot></slot></span>'
  },
  NTooltip: {
    name: 'NTooltip',
    props: ['trigger'],
    template: '<span><slot name="trigger"></slot></span>'
  },
  NDivider: {
    name: 'NDivider',
    props: ['vertical'],
    template: '<span class="n-divider"></span>'
  },
  NDropdown: {
    name: 'NDropdown',
    props: ['trigger', 'options'],
    template: '<div><slot></slot></div>'
  },
  NModal: {
    name: 'NModal',
    props: ['show', 'preset', 'title'],
    template: '<div v-if="show"><slot></slot></div>'
  },
  NInput: {
    name: 'NInput',
    props: ['value', 'type', 'placeholder', 'rows'],
    template: '<input :value="value" />'
  },
  NSwitch: {
    name: 'NSwitch',
    props: ['value', 'size'],
    template: '<input type="checkbox" :checked="value" />'
  },
  useMessage: vi.fn(() => mocks.message),
  useNotification: vi.fn(() => mocks.notification),
  useDialog: vi.fn(() => mocks.dialog)
}))

// Mock db
vi.mock('@/db', () => ({
  db: {
    getPageImage: vi.fn(),
    getPageOCR: vi.fn()
  }
}))

// Mock URL methods
const mockObjectUrl = 'blob:http://localhost/mock-url'
globalThis.URL.createObjectURL = vi.fn(() => mockObjectUrl)
globalThis.URL.revokeObjectURL = vi.fn()

describe('PageViewer.vue', () => {
  let mockPage: import("@/stores/pages").Page

  // Helper function to mount PageViewer with i18n
  function mountPageViewer(props = {}, piniaInitialState = {}) {
    return mount(PageViewer, {
      global: {
        plugins: [
          i18n,
          createTestingPinia({
            initialState: {
              pages: {
                showOverlay: true,
                ...piniaInitialState
              }
            },
            stubActions: false
          })
        ]
      },
      props
    })
  }

  beforeEach(() => {
    mockPage = {
      id: 'page-1',
      fileName: 'test.pdf',
      fileSize: 1024 * 1024,
      fileType: 'application/pdf',
      origin: 'upload',
      status: 'ready',
      progress: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
      outputs: [],
      logs: [],
      order: 0
    }
    vi.clearAllMocks()
    vi.mocked(db.getPageImage).mockResolvedValue(new Blob(['mock-image'], { type: 'image/png' }))
    vi.mocked(db.getPageOCR).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('renders select placeholder when no page is provided', () => {
    const wrapper = mountPageViewer({
      currentPage: null
    })

    expect(wrapper.find('.placeholder-select').exists()).toBe(true)
    expect(wrapper.find('.placeholder-select').text()).toContain('Select a page to view')
  })

  it('loads and displays image when a page is provided', async () => {
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

    // Wait for promises to resolve
    await flushPromises()

    // Should call getPageImage
    expect(db.getPageImage).toHaveBeenCalledWith(mockPage.id)

    // Wait for async image loading
    await vi.waitFor(() => {
      if (!wrapper.find('.page-image').exists()) throw new Error('not found')
    })

    const img = wrapper.find('.page-image')
    expect(img.attributes('src')).toBe(mockObjectUrl)
  })

  it('handles zoom controls correctly', async () => {
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

    // Initial zoom is 1
    expect((wrapper.vm as any).zoomLevel).toBe(1)

    // Zoom in
    const buttons = wrapper.findAll('button')
    const zoomInBtn = buttons.find(b => b.text() === '+')
    await zoomInBtn?.trigger('click')
    expect((wrapper.vm as any).zoomLevel).toBe(1.25)

    // Zoom out
    const zoomOutBtn = buttons.find(b => b.text() === '−')
    await zoomOutBtn?.trigger('click')
    expect((wrapper.vm as any).zoomLevel).toBe(1.0)

    // Fit to screen
    const fitBtn = buttons.find(b => b.text() === 'Fit')
    await zoomInBtn?.trigger('click') // zoom to 1.25 again
    await fitBtn?.trigger('click')
    expect((wrapper.vm as any).zoomLevel).toBe(1)
  })

  it('limits zoom level between 0.25 and 3', async () => {
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

    const zoomInBtn = wrapper.findAll('button').find(b => b.text() === '+')
    const zoomOutBtn = wrapper.findAll('button').find(b => b.text() === '−')

    // Test upper limit
    for (let i = 0; i < 10; i++) await zoomInBtn?.trigger('click')
    expect((wrapper.vm as any).zoomLevel).toBe(3)
    expect(zoomInBtn?.attributes('disabled')).toBeDefined()

    // Test lower limit
    for (let i = 0; i < 15; i++) await zoomOutBtn?.trigger('click')
    expect((wrapper.vm as any).zoomLevel).toBe(0.25)
    expect(zoomOutBtn?.attributes('disabled')).toBeDefined()
  })

  it('shows error message if image is not found in DB', async () => {
    vi.mocked(db.getPageImage).mockResolvedValue(undefined)

    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

    // Should call getPageImage (at least once, maybe twice due to retry)
    await vi.waitFor(() => {
      if (vi.mocked(db.getPageImage).mock.calls.length === 0) throw new Error('not called')
      // If it fails, wait long enough for the retry to finish (100ms delay in code)
      if (wrapper.find('.error-overlay').exists()) return
      throw new Error('error overlay not shown')
    }, { timeout: 1000 })

    expect(wrapper.find('.error-overlay').exists()).toBe(true)
    expect(db.getPageImage).toHaveBeenCalled()
  })

  it('displays correct status text for all statuses', () => {
    const statuses: string[] = ['pending_render', 'rendering', 'ready', 'recognizing', 'completed', 'error', 'unknown']
    const expectedTexts = ['Pending Render', 'Rendering', 'Ready', 'Recognizing', 'Completed', 'Error', 'Unknown']

    statuses.forEach((status, index) => {
      const wrapper = mountPageViewer({
        currentPage: { ...mockPage, status: status as any }
      })
      expect(wrapper.find('.viewer-toolbar').text()).toContain(`Status: ${expectedTexts[index]}`)
    })
  })

  it('covers all formatFileSize branches', () => {
    const testCases = [
      { bytes: 0, expected: '0 B' },
      { bytes: 500, expected: '500 B' },
      { bytes: 1024 * 1.5, expected: '1.5 KB' },
      { bytes: 1024 * 1024 * 2, expected: '2 MB' },
      { bytes: 1024 * 1024 * 1024 * 3.5, expected: '3.5 GB' }
    ]

    testCases.forEach(({ bytes, expected }) => {
      const wrapper = mountPageViewer({
        currentPage: { ...mockPage, fileSize: bytes }
      })
      expect(wrapper.find('.viewer-toolbar').text()).toContain(`File: ${expected}`)
    })
  })

  it('revokes URL when current page changes', async () => {
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

    await vi.waitFor(() => {
      if ((wrapper.vm as any).fullImageUrl === '') throw new Error('not loaded')
    })

    const oldUrl = (wrapper.vm as any).fullImageUrl

    // Change page
    await wrapper.setProps({ currentPage: { ...mockPage, id: 'page-2' } })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(oldUrl)
  })

  it('handles image error and updates state', async () => {
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

    await vi.waitFor(() => {
      if (!wrapper.find('.page-image').exists()) throw new Error('not found')
    })

    // Explicitly call the handler to ensure coverage of those lines
    await (wrapper.vm as any).onImageError()
    expect((wrapper.vm as any).imageSize).toBe('Load failed')
    expect((wrapper.vm as any).imageError).toBe('Failed to load image')
  })

  it('handles submitOCR error (no blob)', async () => {
    vi.mocked(db.getPageImage).mockResolvedValue(undefined)
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })
    await (wrapper.vm as any).submitOCR('document')
    const message = (wrapper.vm as any).message
    expect(message.error).toHaveBeenCalledWith('Could not retrieve image data')
  })

  it('guards submitOCR execution', async () => {
    // 1. No current page
    const wrapper1 = mountPageViewer({
      currentPage: null
    })
      ; await (wrapper1.vm as any).submitOCR('document') // Should return early

    // 2. Status is processing (mocked as recognizing in this context for guard check)
    const processingPage = { ...mockPage, status: 'recognizing' as const }
    const wrapper2 = mountPageViewer({
      currentPage: processingPage
    })
      ; await (wrapper2.vm as any).submitOCR('document') // Should return early

    // 3. Normal execution
    const wrapper3 = mountPageViewer({
      currentPage: mockPage
    })
    await flushPromises()
      ; await (wrapper3.vm as any).submitOCR('document') // Should log/execute
    expect(uiLogger.info).toHaveBeenCalled()
  })

  it('handles submitOCR with queue full error', async () => {
    vi.mocked(db.getPageImage).mockResolvedValue(new Blob(['img'], { type: 'image/jpeg' }))

    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

    const healthStore = useHealthStore()
    healthStore.healthInfo = { status: 'full' } as any

    await (wrapper.vm as any).submitOCR('document')

    expect(mocks.dialog.error).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Queue Full',
      content: 'OCR queue is full. Please try again later.',
    }))
    expect(ocrService.queueOCR).not.toHaveBeenCalled()
  })

  it('handles handleOCRRun branches', async () => {
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })
    // Branch 1: 'find' or 'freeform' -> shows modal
    await (wrapper.vm as any).handleOCRRun('find')
    expect((wrapper.vm as any).inputModalShow).toBe(true)
    expect((wrapper.vm as any).targetInputMode).toBe('find')

    // Branch 2: other -> direct submit (triggers logger)
    await (wrapper.vm as any).handleOCRRun('document')
    expect(uiLogger.info).toHaveBeenCalledWith(expect.stringContaining('Adding page to OCR Queue'), mockPage.id)
  })

  it('handles handleInputSubmit', async () => {
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })

      // Case 1: find
      ; (wrapper.vm as any).targetInputMode = 'find'
    await (wrapper.vm as any).handleInputSubmit('test-find')
    expect(uiLogger.info).toHaveBeenCalledWith(expect.stringContaining('(find)'), mockPage.id)

      // Case 2: freeform
      ; (wrapper.vm as any).targetInputMode = 'freeform'
    await (wrapper.vm as any).handleInputSubmit('test-prompt')
    expect(uiLogger.info).toHaveBeenCalledWith(expect.stringContaining('(freeform)'), mockPage.id)
  })

  it('disables OCRModeSelector when status is not ready', async () => {
    const processingPage = { ...mockPage, status: 'recognizing' as const }
    const wrapper = mountPageViewer({
      currentPage: processingPage
    })

    // Check if OCRModeSelector is disabled via prop
    expect((wrapper.vm as any).isPageProcessing).toBe(true)
  })

  it('handles image load failure with retry', async () => {
    vi.useFakeTimers()
    vi.mocked(db.getPageImage)
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockResolvedValueOnce(new Blob(['test'], { type: 'image/png' }))

    mountPageViewer({
      currentPage: mockPage
    })

    await flushPromises()
    // Should be retrying.
    // In some environments, watch might trigger twice causing 2 calls immediately.
    // We capture the count to ensure we verify the specific retry increment.
    const callsBeforeRetry = vi.mocked(db.getPageImage).mock.calls.length
    expect(callsBeforeRetry).toBeGreaterThanOrEqual(1)

    // Fast forward 100ms
    await vi.advanceTimersByTimeAsync(110)

    // Should be called again
    expect(vi.mocked(db.getPageImage).mock.calls.length).toBeGreaterThan(callsBeforeRetry)

    vi.useRealTimers()
  })

  it('cleans up URL on unmount', async () => {
    // Mock success load
    vi.mocked(db.getPageImage).mockResolvedValue(new Blob(['test'], { type: 'image/png' }))

    const wrapper = mountPageViewer({
      currentPage: mockPage
    })
    await flushPromises()

    wrapper.unmount()
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('handles image load event', async () => {
    vi.mocked(db.getPageImage).mockResolvedValue(new Blob(['test'], { type: 'image/png' }))
    const wrapper = mountPageViewer({
      currentPage: mockPage
    })
    await flushPromises()

    const img = wrapper.find('.page-image')
    // Mock naturalWidth/Height on the DOM element
    Object.defineProperty(img.element, 'naturalWidth', { value: 100, writable: true })
    Object.defineProperty(img.element, 'naturalHeight', { value: 200, writable: true })

    await img.trigger('load')

    expect(wrapper.text()).toContain('100 × 200')
  })

  it('re-loads image when status changes from recognizing to ocr_success on same page', async () => {
    const pageId = 'p-same'
    const pageRecognizing = { ...mockPage, id: pageId, status: 'recognizing' as const }
    const pageSuccess = { ...mockPage, id: pageId, status: 'ocr_success' as const }

    const wrapper = mountPageViewer({
      currentPage: pageRecognizing
    })

    await flushPromises()
    vi.mocked(db.getPageImage).mockClear()

    // Page finishes OCR
    await wrapper.setProps({ currentPage: pageSuccess })
    await flushPromises()

    // Should re-trigger image load because it transitioned to a viewable status
    expect(db.getPageImage).toHaveBeenCalledWith(pageId)
  })

  it('loads correct image when switching between different processed pages', async () => {
    const page1 = { ...mockPage, id: 'p1', status: 'ready' as const }
    const page2 = { ...mockPage, id: 'p2', status: 'completed' as const }

    const wrapper = mountPageViewer({
      currentPage: page1
    })

    await flushPromises()
    expect(db.getPageImage).toHaveBeenCalledWith('p1')
    vi.mocked(db.getPageImage).mockClear()

    // Switch to page2 (already completed)
    await wrapper.setProps({ currentPage: page2 })
    await flushPromises()

    // Should load p2 image, even though OCR logic also runs
    expect(db.getPageImage).toHaveBeenCalledWith('p2')
  })
})
