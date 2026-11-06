export default {
    // App
    app: {
        name: 'DeepSeek-OCR-WebUI',
        expandPageList: '展開頁面列表',
        collapsePageList: '收起頁面列表',
        expandViewer: '展開檢視器',
        collapseViewer: '收起檢視器',
        expandPreview: '展開預覽',
        collapsePreview: '收起預覽',
        deleteConfirmTitle: '確認刪除',
        deleteConfirmSingle: '確定要刪除 "{0}" 嗎？',
        deleteConfirmMultiple: '確定要刪除選中的 {0} 個頁面嗎？',
        deleteProcessingWarning: '警告：有 {0} 個頁面正在處理中。刪除它們將取消其任務。',
        deletePositive: '確認',
        deleteNegative: '取消',
        pageDeleted: '已刪除頁面 "{0}"',
        pagesDeleted: '已刪除 {0} 個頁面',
        deleteFailed: '刪除 {0} 失敗',
        addFailed: '添加失敗，請重試。',
        welcomeTitle: 'DeepSeek-OCR-WebUI',
        welcomeDescription: '拖放 PDF 或圖片到此處開始',
        startImport: '選擇文件'
    },

    // Health
    health: {
        ocrService: 'OCR 服務',
        status: '狀態',
        backend: '後端',
        platform: '運行平台',
        modelLoaded: '模型加載',
        yes: '是',
        no: '否',
        lastCheck: '上次檢查',
        healthy: '健康',
        unavailable: '不可用',
        justNow: '剛剛',
        ago: '{0}秒前',
        minutesAgo: '{0}分鐘前',
        busyTooltip: '系統繁忙 (排隊中)',
        fullTooltip: '隊列已滿 (無法提交)',
        queue: '隊列',
        busy: '繁忙',
        full: '已滿',
        starting: '模型載入中',
        startingTooltip: '模型正在載入 / 預熱，新任務會排隊等待並自動開始。',
        modelError: '模型不可用',
        modelErrorDetail: '模型不可用：{0}',
        unreachableTooltip: '無法連線 OCR 服務（網路錯誤或服務未啟動）。',
        engine: '引擎',
        device: '裝置',
        dtype: '精度',
        version: '版本'
    },

    // Header
    header: {
        processing: '處理中',
        waiting: '等待中',
        pagesLoaded: '已加載 {0} 個頁面',
        pageLoaded: '已加載 {0} 個頁面',
        importFiles: '導入文件',
        scan2Doc: 'DeepSeek-OCR-WebUI',
        starProject: '在 GitHub 上給項目點 Star',
        reportIssue: '報告問題或提出建議',
        readDocs: '閱讀項目文檔'
    },

    // Page List
    pageList: {
        noPages: '未添加頁面',
        pageCount: '共 {n} 頁',
        selectedCount: '{0} / {1} 頁',
        selectedCount_plural: '{0} / {1} 頁',
        exportAs: '導出為 {0}',
        scanSelected: '掃描選中頁面為文檔',
        deleteSelected: '刪除選中頁面',
        batchOCR: '批量 OCR',
        addedToQueue: '已將 {0} 個頁面添加到 OCR 隊列',
        skippedProcessed: '跳過 {0} 個已處理',
        allProcessed: '所有選中的頁面都已處理或正在處理中',
        cannotExport: '無法導出',
        allPagesNotReady: '所有 {0} 個選中頁面都沒有 Markdown 數據。',
        somePagesNotReady: '部分頁面未就緒',
        pagesNotReady: '{2} 中有 {0} 個頁面沒有數據（共 {1} 個頁面）',
        youCanCancel: '您可以取消先完成 OCR，或者跳過這些頁面導出其餘部分。',
        skipAndExport: '跳過並導出',
        ok: '確定',
        exportedPages: '已導出 {0} 個頁面',
        exportedSkipped: '已導出 {0} 個頁面（跳過 {1} 個）'
    },

    // OCR Modes
    ocr: {
        scanToDocument: '掃描為文檔',
        generalOCR: '通用 OCR',
        extractRawText: '提取原始文本',
        parseFigure: '解析圖表',
        describeImage: '描述圖像',
        locateObject: '定位對象',
        customPrompt: '自定義提示詞',
        addedToQueue: '已添加到 OCR 隊列',
        couldNotRetrieveImage: '無法獲取圖像數據',
        ocrFailed: 'OCR 失敗：{0}'
    },

    // OCR Input Modal
    ocrInput: {
        enterPrompt: '輸入您的提示詞',
        enterSearchTerm: '輸入搜索詞',
        submit: '提交',
        cancel: '取消',
        promptPlaceholder: '描述您想要提取的內容...',
        searchPlaceholder: '輸入要定位的文本...'
    },

    // Status labels
    status: {
        pendingRender: '等待渲染',
        rendering: '渲染中',
        ready: '就緒',
        ocrQueued: 'OCR 隊列中',
        recognizing: '識別中...',
        ocrDone: 'OCR 完成',
        waitingForGen: '等待生成',
        generating: '生成中...',
        generatingMarkdown: '生成 Markdown 中...',
        markdownReady: 'Markdown 已就緒',
        generatingDOCX: '生成 DOCX 中...',
        generatingPDF: '生成 PDF 中...',
        docxReady: 'DOCX 已就緒',
        pdfReady: 'PDF 已就緒',
        completed: '已完成',
        error: '錯誤',
        unknown: '未知'
    },

    // Preview
    preview: {
        markdown: 'Markdown',
        word: 'Word',
        pdf: 'PDF',
        preview: '預覽',
        source: '源碼',
        showSource: '顯示源碼',
        showPreview: '顯示預覽',
        download: '下載 {0}',
        downloadMD: '下載 MD',
        downloadDOCX: '下載 DOCX',
        downloadSearchablePDF: '下載可搜索 PDF',
        loadingMarkdown: '加載 Markdown 中...',
        noMarkdown: '暫無 Markdown 內容',
        docxNotReady: 'DOCX 尚未生成',
        pdfNotReady: 'Sandwich PDF 尚未生成',
        checkingPDF: '檢查 PDF 狀態...',
        loadingDOCX: '加載 DOCX 中...',
        failedToLoad: '加載內容失敗。',
        copy: '複製',
        copied: '已複製！'
    },

    // Page Viewer
    pageViewer: {
        page: '頁面',
        noImageAvailable: '無可用圖像',
        selectPageToView: '選擇一個頁面查看',
        loadingImage: '加載圖像中...',
        status: '狀態',
        size: '尺寸',
        file: '文件',
        loadFailed: '加載失敗',
        failedToLoadImage: '圖像加載失敗',
        fullImageNotFound: '存儲中未找到完整圖像',
        failedToLoadFromStorage: '從存儲加載圖像失敗',
        fit: '適應',
        showOverlay: '顯示/隱藏高亮',
        hideOverlay: '隱藏 OCR 高亮',
        showOverlayTooltip: '顯示 OCR 高亮'
    },


    // OCR Queue Popover
    ocrQueue: {
        activeTasks: '進行中',
        queuedTasks: '隊列中',
        noActiveTasks: '無活躍 OCR 任務',
        noQueuedTasks: '無排隊 OCR 任務',
        queuePosition: '排隊中 (第 {0} 位)',
        processing: '處理中 (第 {0} 位)',
        submitting: '提交中...'
    },

    // Raw Text Panel
    rawTextPanel: {
        rawText: '原始文本',
        copy: '複製',
        copied: '已複製！',
        copyFailed: '複製失敗'
    },

    // OCR Result Overlay
    ocrResult: {
        noRecognizedText: '無識別文本可顯示'
    },

    // Common
    common: {
        confirm: '確認',
        cancel: '取消',
        ok: '確定',
        delete: '刪除',
        export: '導出',
        close: '關閉',
        language: '語言',
        english: 'English',
        chinese: '简体中文',
        traditionalChinese: '繁體中文',
        japanese: '日本語'
    },

    // Page Item
    pageItem: {
        scanToDocument: '掃描為文檔',
        deletePage: '刪除頁面',
        outputWarning: 'OCR 結果可能不可靠'
    },

    // OCR Queue Popover
    ocrQueuePopover: {
        title: 'OCR 隊列',
        cancelSelected: '取消選中的任務',
        cancelAll: '取消全部',
        selectAll: '全選',
        recognizing: '識別中...',
        waiting: '等待中...',
        close: '關閉',
        cancelTask: '取消任務',
        taskCancelled: '任務已取消',
        tasksCancelled: '已取消 {n} 個任務',
        allTasksCancelled: '已取消所有任務',
        modelLoading: '模型載入中，排隊任務將在就緒後自動開始。',
        modelError: '模型不可用：{0}'
    },

    // OCR Input Modal
    ocrInputModal: {
        locateObject: '定位對象',
        customPrompt: '自定義提示詞',
        locatePlaceholder: '輸入要定位的對象名稱...',
        promptPlaceholder: '輸入您的自定義提示詞...',
        locate: '定位',
        runOCR: '運行 OCR'
    },

    // OCR Raw Text Panel
    ocrRawTextPanel: {
        title: 'OCR 原始結果',
        copy: '複製',
        noRawText: '無原始文本',
        copied: '已複製！',
        copyFailed: '複製失敗',
        warnings: '產物檢查',
        finishReason: '結束原因',
        finishStop: '正常結束',
        finishLength: '達到最大長度（可能被截斷）',
        finishRepetitionCut: '偵測到重複輸出，已提前停止',
        hint: '提示'
    },

    // Error messages
    errors: {
        noFilesSelected: '未選擇文件',
        unsupportedFileType: '不支持的文件類型',
        failedToLoadMarkdown: '加載 Markdown 失敗',
        failedToExportMarkdown: '導出 Markdown 失敗',
        ocrServiceUnavailable: 'OCR 服務目前不可用，請稍後再試。',
        ocrServiceUnavailableTitle: '服務不可用',
        ocrQueueFull: 'OCR 隊列已滿，請稍後再試。',
        ocrQueueFullTitle: '隊列已滿'
    }
} as const
