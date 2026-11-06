export default {
  // App
  app: {
    name: 'DeepSeek-OCR-WebUI',
    expandPageList: '展开页面列表',
    collapsePageList: '收起页面列表',
    expandViewer: '展开查看器',
    collapseViewer: '收起查看器',
    expandPreview: '展开预览',
    collapsePreview: '收起预览',
    deleteConfirmTitle: '确认删除',
    deleteConfirmSingle: '确定要删除 "{0}" 吗？',
    deleteConfirmMultiple: '确定要删除选中的 {0} 个页面吗？',
    deleteProcessingWarning: '警告：有 {0} 个页面正在处理中。删除它们将取消其任务。',
    deletePositive: '确认',
    deleteNegative: '取消',
    pageDeleted: '已删除页面 "{0}"',
    pagesDeleted: '已删除 {0} 个页面',
    deleteFailed: '删除{0}失败',
    addFailed: '添加失败，请重试。',
    welcomeTitle: 'DeepSeek-OCR-WebUI',
    welcomeDescription: '拖放 PDF 或图片到此处开始',
    startImport: '选择文件'
  },

  // Health
  health: {
    ocrService: 'OCR 服务',
    status: '状态',
    backend: '后端',
    platform: '运行平台',
    modelLoaded: '模型加载',
    yes: '是',
    no: '否',
    lastCheck: '上次检查',
    healthy: '健康',
    unavailable: '不可用',
    justNow: '刚刚',
    ago: '{0}秒前',
    minutesAgo: '{0}分钟前',
    busyTooltip: '系统繁忙 (排队中)',
    fullTooltip: '队列已满 (无法提交)',
    queue: '排队',
    busy: '繁忙',
    full: '已满',
    starting: '模型加载中',
    startingTooltip: '模型正在加载 / 预热，新任务会排队等待并自动开始。',
    modelError: '模型不可用',
    modelErrorDetail: '模型不可用：{0}',
    unreachableTooltip: '无法连接 OCR 服务（网络错误或服务未启动）。',
    engine: '引擎',
    device: '设备',
    dtype: '精度',
    version: '版本'
  },

  // Header
  header: {
    processing: '处理中',
    waiting: '等待中',
    pagesLoaded: '已加载 {0} 个页面',
    pageLoaded: '已加载 {0} 个页面',
    importFiles: '导入文件',
    scan2Doc: 'DeepSeek-OCR-WebUI',
    starProject: '在 GitHub 上给项目点 Star',
    reportIssue: '报告问题或提出建议',
    readDocs: '阅读项目文档'
  },

  // Page List
  pageList: {
    noPages: '未添加页面',
    pageCount: '共 {n} 页',
    selectedCount: '{0} / {1} 页',
    selectedCount_plural: '{0} / {1} 页',
    exportAs: '导出为 {0}',
    scanSelected: '扫描选中页面为文档',
    deleteSelected: '删除选中页面',
    batchOCR: '批量 OCR',
    addedToQueue: '已将 {0} 个页面添加到 OCR 队列',
    skippedProcessed: '跳过 {0} 个已处理',
    allProcessed: '所有选中的页面都已处理或正在处理中',
    cannotExport: '无法导出',
    allPagesNotReady: '所有 {0} 个选中页面都没有 Markdown 数据。',
    somePagesNotReady: '部分页面未就绪',
    pagesNotReady: '{2} 中有 {0} 个页面没有数据（共 {1} 个页面）',
    youCanCancel: '您可以取消先完成 OCR，或者跳过这些页面导出其余部分。',
    skipAndExport: '跳过并导出',
    ok: '确定',
    exportedPages: '已导出 {0} 个页面',
    exportedSkipped: '已导出 {0} 个页面（跳过 {1} 个）'
  },

  // OCR Modes
  ocr: {
    scanToDocument: '扫描为文档',
    generalOCR: '通用 OCR',
    extractRawText: '提取原始文本',
    parseFigure: '解析图表',
    describeImage: '描述图像',
    locateObject: '定位对象',
    customPrompt: '自定义提示词',
    addedToQueue: '已添加到 OCR 队列',
    couldNotRetrieveImage: '无法获取图像数据',
    ocrFailed: 'OCR 失败：{0}'
  },

  // OCR Input Modal
  ocrInput: {
    enterPrompt: '输入您的提示词',
    enterSearchTerm: '输入搜索词',
    submit: '提交',
    cancel: '取消',
    promptPlaceholder: '描述您想要提取的内容...',
    searchPlaceholder: '输入要定位的文本...'
  },

  // Status labels
  status: {
    pendingRender: '等待渲染',
    rendering: '渲染中',
    ready: '就绪',
    ocrQueued: 'OCR 队列中',
    recognizing: '识别中...',
    ocrDone: 'OCR 完成',
    waitingForGen: '等待生成',
    generating: '生成中...',
    generatingMarkdown: '生成 Markdown 中...',
    markdownReady: 'Markdown 已就绪',
    generatingDOCX: '生成 DOCX 中...',
    generatingPDF: '生成 PDF 中...',
    docxReady: 'DOCX 已就绪',
    pdfReady: 'PDF 已就绪',
    completed: '已完成',
    error: '错误',
    unknown: '未知'
  },

  // Preview
  preview: {
    markdown: 'Markdown',
    word: 'Word',
    pdf: 'PDF',
    preview: '预览',
    source: '源码',
    showSource: '显示源码',
    showPreview: '显示预览',
    download: '下载 {0}',
    downloadMD: '下载 MD',
    downloadDOCX: '下载 DOCX',
    downloadSearchablePDF: '下载可搜索 PDF',
    loadingMarkdown: '加载 Markdown 中...',
    noMarkdown: '暂无 Markdown 内容',
    docxNotReady: 'DOCX 尚未生成',
    pdfNotReady: 'Sandwich PDF 尚未生成',
    checkingPDF: '检查 PDF 状态...',
    loadingDOCX: '加载 DOCX 中...',
    failedToLoad: '加载内容失败。',
    copy: '复制',
    copied: '已复制！'
  },

  // Page Viewer
  pageViewer: {
    page: '页面',
    noImageAvailable: '无可用图像',
    selectPageToView: '选择一个页面查看',
    loadingImage: '加载图像中...',
    status: '状态',
    size: '尺寸',
    file: '文件',
    loadFailed: '加载失败',
    failedToLoadImage: '图像加载失败',
    fullImageNotFound: '存储中未找到完整图像',
    failedToLoadFromStorage: '从存储加载图像失败',
    fit: '适应',
    showOverlay: '显示/隐藏高亮',
    hideOverlay: '隐藏 OCR 高亮',
    showOverlayTooltip: '显示 OCR 高亮'
  },


  // OCR Queue Popover
  ocrQueue: {
    activeTasks: '进行中',
    queuedTasks: '队列中',
    noActiveTasks: '无活跃 OCR 任务',
    noQueuedTasks: '无排队 OCR 任务',
    queuePosition: '排队中 (第 {0} 位)',
    processing: '处理中 (第 {0} 位)',
    submitting: '提交中...'
  },

  // Raw Text Panel
  rawTextPanel: {
    rawText: '原始文本',
    copy: '复制',
    copied: '已复制！',
    copyFailed: '复制失败'
  },

  // OCR Result Overlay
  ocrResult: {
    noRecognizedText: '无识别文本可显示'
  },

  // Common
  common: {
    confirm: '确认',
    cancel: '取消',
    ok: '确定',
    delete: '删除',
    export: '导出',
    close: '关闭',
    language: '语言',
    english: 'English',
    chinese: '简体中文',
    traditionalChinese: '繁体中文',
    japanese: '日本语'
  },

  // Page Item
  pageItem: {
    scanToDocument: '扫描为文档',
    deletePage: '删除页面',
    outputWarning: 'OCR 结果可能不可靠'
  },

  // OCR Queue Popover
  ocrQueuePopover: {
    title: 'OCR 队列',
    cancelSelected: '取消选中的任务',
    cancelAll: '取消全部',
    selectAll: '全选',
    recognizing: '识别中...',
    waiting: '等待中...',
    close: '关闭',
    cancelTask: '取消任务',
    taskCancelled: '任务已取消',
    tasksCancelled: '已取消 {n} 个任务',
    allTasksCancelled: '已取消所有任务',
    modelLoading: '模型加载中，排队任务将在就绪后自动开始。',
    modelError: '模型不可用：{0}'
  },

  // OCR Input Modal
  ocrInputModal: {
    locateObject: '定位对象',
    customPrompt: '自定义提示词',
    locatePlaceholder: '输入要定位的对象名称...',
    promptPlaceholder: '输入您的自定义提示词...',
    locate: '定位',
    runOCR: '运行 OCR'
  },

  // OCR Raw Text Panel
  ocrRawTextPanel: {
    title: 'OCR 原始结果',
    copy: '复制',
    noRawText: '无原始文本',
    copied: '已复制！',
    copyFailed: '复制失败',
    warnings: '产物检查',
    finishReason: '结束原因',
    finishStop: '正常结束',
    finishLength: '达到最大长度（可能被截断）',
    finishRepetitionCut: '检测到复读，已提前停止',
    hint: '提示'
  },

  // Error messages
  errors: {
    noFilesSelected: '未选择文件',
    unsupportedFileType: '不支持的文件类型',
    failedToLoadMarkdown: '加载 Markdown 失败',
    failedToExportMarkdown: '导出 Markdown 失败',
    ocrServiceUnavailable: 'OCR 服务目前不可用，请稍后再试。',
    ocrServiceUnavailableTitle: '服务不可用',
    ocrQueueFull: 'OCR 队列已满，请稍后再试。',
    ocrQueueFullTitle: '队列已满'
  }
} as const
