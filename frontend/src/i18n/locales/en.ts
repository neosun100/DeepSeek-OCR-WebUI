export default {
  // App
  app: {
    name: 'DeepSeek-OCR-WebUI',
    expandPageList: 'Expand Page List',
    collapsePageList: 'Collapse Page List',
    expandViewer: 'Expand Viewer',
    collapseViewer: 'Collapse Viewer',
    expandPreview: 'Expand Preview',
    collapsePreview: 'Collapse Preview',
    deleteConfirmTitle: 'Confirm Deletion',
    deleteConfirmSingle: 'Are you sure you want to delete "{0}"?',
    deleteConfirmMultiple: 'Are you sure you want to delete {0} selected pages?',
    deleteProcessingWarning: 'Warning: {0} pages are currently being processed. Deleting them will cancel their tasks.',
    deletePositive: 'Confirm',
    deleteNegative: 'Cancel',
    pageDeleted: 'Page "{0}" deleted',
    pagesDeleted: '{0} pages deleted',
    deleteFailed: 'Failed to delete {0}',
    addFailed: 'Add failed. Please try again.',
    welcomeTitle: 'DeepSeek-OCR-WebUI',
    welcomeDescription: 'Drop PDF or Images here to start',
    startImport: 'Select Files'
  },

  // Health
  health: {
    ocrService: 'OCR Service',
    status: 'Status',
    backend: 'Backend',
    platform: 'Platform',
    modelLoaded: 'Model Loaded',
    yes: 'Yes',
    no: 'No',
    lastCheck: 'Last check',
    healthy: 'Healthy',
    unavailable: 'Unavailable',
    justNow: 'just now',
    ago: '{0}s ago',
    minutesAgo: '{0}m ago',
    busyTooltip: 'System Busy (Queued)',
    fullTooltip: 'Queue Full (Cannot Submit)',
    queue: 'Queue',
    busy: 'Busy',
    full: 'Full',
    starting: 'Model loading',
    startingTooltip: 'The model is loading / warming up. New tasks wait in the queue and start automatically.',
    modelError: 'Model unavailable',
    modelErrorDetail: 'Model unavailable: {0}',
    unreachableTooltip: 'Cannot reach the OCR service (network error or server down).',
    engine: 'Engine',
    device: 'Device',
    dtype: 'Precision',
    version: 'Version'
  },

  // Header
  header: {
    processing: 'Processing',
    waiting: 'Waiting',
    pagesLoaded: '{0} Pages Loaded',
    pageLoaded: '{0} Page Loaded',
    importFiles: 'Import Files',
    scan2Doc: 'DeepSeek-OCR-WebUI',
    starProject: 'Star this project on GitHub',
    reportIssue: 'Report a bug or request a feature',
    readDocs: 'Read the documentation'
  },

  // Page List
  pageList: {
    noPages: 'No pages added',
    pageCount: '{n} page | {n} pages',
    selectedCount: '{0} / {1} page',
    selectedCount_plural: '{0} / {1} pages',
    exportAs: 'Export as {0}',
    scanSelected: 'Scan selected pages to document',
    deleteSelected: 'Delete selected pages',
    batchOCR: 'Batch OCR',
    addedToQueue: 'Added {0} page{1} to OCR queue',
    skippedProcessed: 'skipped {0} processed',
    allProcessed: 'All selected pages are already processed or being processed',
    cannotExport: 'Cannot Export',
    allPagesNotReady: 'All {0} selected pages don\'t have Markdown data yet.',
    somePagesNotReady: 'Some Pages Not Ready',
    pagesNotReady: '{0} of {1} pages don\'t have {2} data yet',
    youCanCancel: 'You can cancel to complete OCR first, or skip these pages and export the rest.',
    skipAndExport: 'Skip & Export',
    ok: 'OK',
    exportedPages: 'Exported {0} pages',
    exportedSkipped: 'Exported {0} pages (skipped {1})'
  },

  // OCR Modes
  ocr: {
    scanToDocument: 'Scan to Document',
    generalOCR: 'General OCR',
    extractRawText: 'Extract Raw Text',
    parseFigure: 'Parse Figure',
    describeImage: 'Describe Image',
    locateObject: 'Locate Object',
    customPrompt: 'Custom Prompt',
    addedToQueue: 'Added to OCR Queue',
    couldNotRetrieveImage: 'Could not retrieve image data',
    ocrFailed: 'OCR Failed: {0}'
  },

  // OCR Input Modal
  ocrInput: {
    enterPrompt: 'Enter your prompt',
    enterSearchTerm: 'Enter search term',
    submit: 'Submit',
    cancel: 'Cancel',
    promptPlaceholder: 'Describe what you want to extract...',
    searchPlaceholder: 'Enter text to locate...'
  },

  // Status labels
  status: {
    pendingRender: 'Pending Render',
    rendering: 'Rendering',
    ready: 'Ready',
    ocrQueued: 'OCR Queued',
    recognizing: 'Recognizing...',
    ocrDone: 'OCR Done',
    waitingForGen: 'Waiting for Gen',
    generating: 'Generating...',
    generatingMarkdown: 'Generating Markdown...',
    markdownReady: 'Markdown Ready',
    generatingDOCX: 'Generating DOCX...',
    generatingPDF: 'Generating PDF...',
    docxReady: 'DOCX Ready',
    pdfReady: 'PDF Ready',
    completed: 'Completed',
    error: 'Error',
    unknown: 'Unknown'
  },

  // Preview
  preview: {
    markdown: 'Markdown',
    word: 'Word',
    pdf: 'PDF',
    preview: 'Preview',
    source: 'Source',
    showSource: 'Show Source Code',
    showPreview: 'Show Rendered Preview',
    download: 'Download {0}',
    downloadMD: 'Download MD',
    downloadDOCX: 'Download DOCX',
    downloadSearchablePDF: 'Download Searchable PDF',
    loadingMarkdown: 'Loading markdown...',
    noMarkdown: 'No markdown content available',
    docxNotReady: 'DOCX not generated yet',
    pdfNotReady: 'Sandwich PDF not generated yet',
    checkingPDF: 'Checking PDF status...',
    loadingDOCX: 'Loading DOCX...',
    failedToLoad: 'Failed to load content.',
    copy: 'Copy',
    copied: 'Copied!'
  },

  // Page Viewer
  pageViewer: {
    page: 'Page',
    noImageAvailable: 'No image available',
    selectPageToView: 'Select a page to view',
    loadingImage: 'Loading image...',
    status: 'Status',
    size: 'Size',
    file: 'File',
    loadFailed: 'Load failed',
    failedToLoadImage: 'Failed to load image',
    fullImageNotFound: 'Full image not found in storage',
    failedToLoadFromStorage: 'Failed to load image from storage',
    fit: 'Fit',
    showOverlay: 'Show Overlay',
    hideOverlay: 'Hide OCR Overlay',
    showOverlayTooltip: 'Show OCR Overlay'
  },


  // OCR Queue Popover
  ocrQueue: {
    activeTasks: 'Active',
    queuedTasks: 'Queued',
    noActiveTasks: 'No active OCR tasks',
    noQueuedTasks: 'No queued OCR tasks',
    queuePosition: 'Queued (#{0})',
    processing: 'Processing (#1)',
    submitting: 'Submitting...'
  },

  // Raw Text Panel
  rawTextPanel: {
    rawText: 'Raw Text',
    copy: 'Copy',
    copied: 'Copied!',
    copyFailed: 'Copy failed'
  },

  // OCR Result Overlay
  ocrResult: {
    noRecognizedText: 'No recognized text to display'
  },

  // Common
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    ok: 'OK',
    delete: 'Delete',
    export: 'Export',
    close: 'Close',
    language: 'Language',
    english: 'English',
    chinese: '中文',
    traditionalChinese: 'Traditional Chinese',
    japanese: 'Japanese'
  },

  // Page Item
  pageItem: {
    scanToDocument: 'Scan to Document',
    deletePage: 'Delete page',
    outputWarning: 'OCR output may be unreliable'
  },

  // OCR Queue Popover
  ocrQueuePopover: {
    title: 'OCR Queue',
    cancelSelected: 'Cancel selected tasks',
    cancelAll: 'Cancel All',
    selectAll: 'Select All',
    recognizing: 'Recognizing...',
    waiting: 'Waiting...',
    close: 'Close',
    cancelTask: 'Cancel Task',
    taskCancelled: 'Task cancelled',
    tasksCancelled: '{n} tasks cancelled',
    allTasksCancelled: 'All tasks cancelled',
    modelLoading: 'Model is loading; queued tasks start when it is ready.',
    modelError: 'Model unavailable: {0}'
  },

  // OCR Input Modal
  ocrInputModal: {
    locateObject: 'Locate Object',
    customPrompt: 'Custom Prompt',
    locatePlaceholder: 'Enter the object name to locate...',
    promptPlaceholder: 'Enter your custom prompt...',
    locate: 'Locate',
    runOCR: 'Run OCR'
  },

  // OCR Raw Text Panel
  ocrRawTextPanel: {
    title: 'OCR Raw Result',
    copy: 'Copy',
    noRawText: 'No raw text available',
    copied: 'Copied!',
    copyFailed: 'Copy failed',
    warnings: 'Output checks',
    finishReason: 'Finish reason',
    finishStop: 'Completed',
    finishLength: 'Hit max length (may be truncated)',
    finishRepetitionCut: 'Stopped early: repetition cut',
    hint: 'Hint'
  },

  // Error messages
  errors: {
    noFilesSelected: 'No files selected',
    unsupportedFileType: 'Unsupported file type',
    failedToLoadMarkdown: 'Failed to load markdown',
    failedToExportMarkdown: 'Failed to export markdown',
    ocrServiceUnavailable: 'OCR service is currently unavailable. Please try again later.',
    ocrServiceUnavailableTitle: 'Service Unavailable',
    ocrQueueFull: 'OCR queue is full. Please try again later.',
    ocrQueueFullTitle: 'Queue Full'
  }
} as const
