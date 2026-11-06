export default {
    // App
    app: {
        name: 'DeepSeek-OCR-WebUI',
        expandPageList: 'ページリストを展開',
        collapsePageList: 'ページリストを折りたたむ',
        expandViewer: 'ビューワーを展開',
        collapseViewer: 'ビューワーを折りたたむ',
        expandPreview: 'プレビューを展開',
        collapsePreview: 'プレビューを折りたたむ',
        deleteConfirmTitle: '削除の確認',
        deleteConfirmSingle: '"{0}" を削除してもよろしいですか？',
        deleteConfirmMultiple: '選択した {0} ページを削除してもよろしいですか？',
        deleteProcessingWarning: '警告: 現在 {0} ページが処理中です。削除するとタスクがキャンセルされます。',
        deletePositive: '確認',
        deleteNegative: 'キャンセル',
        pageDeleted: 'ページ "{0}" を削除しました',
        pagesDeleted: '{0} ページを削除しました',
        deleteFailed: '{0} の削除に失敗しました',
        addFailed: '追加に失敗しました。もう一度お試しください。',
        welcomeTitle: 'DeepSeek-OCR-WebUI',
        welcomeDescription: 'PDFまたは画像をここにドロップして開始',
        startImport: 'ファイルを選択'
    },

    // Health
    health: {
        ocrService: 'OCR サービス',
        status: 'ステータス',
        backend: 'バックエンド',
        platform: 'プラットフォーム',
        modelLoaded: 'モデルロード済み',
        yes: 'はい',
        no: 'いいえ',
        lastCheck: '最終確認',
        healthy: '正常',
        unavailable: '利用不可',
        justNow: 'たった今',
        ago: '{0}秒前',
        minutesAgo: '{0}分前',
        busyTooltip: 'システム混雑中 (キュー待機)',
        fullTooltip: 'キュー満杯 (送信不可)',
        queue: 'キュー',
        busy: '混雑',
        full: '満杯',
        starting: 'モデル読み込み中',
        startingTooltip: 'モデルを読み込み / ウォームアップ中です。新しいタスクはキューで待機し、自動的に開始されます。',
        modelError: 'モデル利用不可',
        modelErrorDetail: 'モデル利用不可：{0}',
        unreachableTooltip: 'OCR サービスに接続できません（ネットワークエラーまたはサーバー停止）。',
        engine: 'エンジン',
        device: 'デバイス',
        dtype: '精度',
        version: 'バージョン'
    },

    // Header
    header: {
        processing: '処理中',
        waiting: '待機中',
        pagesLoaded: '{0} ページ読み込み済み',
        pageLoaded: '{0} ページ読み込み済み',
        importFiles: 'ファイルをインポート',
        scan2Doc: 'DeepSeek-OCR-WebUI',
        starProject: 'GitHubでスターをつける',
        reportIssue: 'バグ報告・機能リクエスト',
        readDocs: 'ドキュメントを読む'
    },

    // Page List
    pageList: {
        noPages: 'ページが追加されていません',
        pageCount: '全 {n} ページ',
        selectedCount: '{0} / {1} ページ',
        selectedCount_plural: '{0} / {1} ページ',
        exportAs: '{0} としてエクスポート',
        scanSelected: '選択したページをドキュメントとしてスキャン',
        deleteSelected: '選択したページを削除',
        batchOCR: '一括 OCR',
        addedToQueue: '{0} ページを OCR キューに追加しました',
        skippedProcessed: '処理済みの {0} ページをスキップしました',
        allProcessed: '選択したすべてのページは処理済みか処理中です',
        cannotExport: 'エクスポートできません',
        allPagesNotReady: '選択した {0} ページすべてに Markdown データがありません。',
        somePagesNotReady: '一部のページが準備できていません',
        pagesNotReady: '{1} ページ中 {0} ページに {2} データがありません',
        youCanCancel: 'キャンセルして OCR を完了するか、これらのページをスキップして残りをエクスポートできます。',
        skipAndExport: 'スキップしてエクスポート',
        ok: 'OK',
        exportedPages: '{0} ページをエクスポートしました',
        exportedSkipped: '{0} ページをエクスポートしました ({1} ページスキップ)'
    },

    // OCR Modes
    ocr: {
        scanToDocument: 'ドキュメントへスキャン',
        generalOCR: '一般 OCR',
        extractRawText: '生テキスト抽出',
        parseFigure: '図表解析',
        describeImage: '画像説明',
        locateObject: 'オブジェクト位置特定',
        customPrompt: 'カスタムプロンプト',
        addedToQueue: 'OCR キューに追加されました',
        couldNotRetrieveImage: '画像データを取得できませんでした',
        ocrFailed: 'OCR 失敗: {0}'
    },

    // OCR Input Modal
    ocrInput: {
        enterPrompt: 'プロンプトを入力',
        enterSearchTerm: '検索語句を入力',
        submit: '送信',
        cancel: 'キャンセル',
        promptPlaceholder: '抽出したい内容を記述してください...',
        searchPlaceholder: '位置特定したいテキストを入力...'
    },

    // Status labels
    status: {
        pendingRender: 'レンダリング待機中',
        rendering: 'レンダリング中',
        ready: '準備完了',
        ocrQueued: 'OCR 待機中',
        recognizing: '認識中...',
        ocrDone: 'OCR 完了',
        waitingForGen: '生成待機中',
        generating: '生成中...',
        generatingMarkdown: 'Markdown 生成中...',
        markdownReady: 'Markdown 準備完了',
        generatingDOCX: 'DOCX 生成中...',
        generatingPDF: 'PDF 生成中...',
        docxReady: 'DOCX 準備完了',
        pdfReady: 'PDF 準備完了',
        completed: '完了',
        error: 'エラー',
        unknown: '不明'
    },

    // Preview
    preview: {
        markdown: 'Markdown',
        word: 'Word',
        pdf: 'PDF',
        preview: 'プレビュー',
        source: 'ソース',
        showSource: 'ソースコードを表示',
        showPreview: 'レンダリング結果を表示',
        download: '{0} をダウンロード',
        downloadMD: 'MD をダウンロード',
        downloadDOCX: 'DOCX をダウンロード',
        downloadSearchablePDF: '検索可能 PDF をダウンロード',
        loadingMarkdown: 'Markdown を読み込み中...',
        noMarkdown: 'Markdown コンテンツがありません',
        docxNotReady: 'DOCX はまだ生成されていません',
        pdfNotReady: 'Sandwich PDF はまだ生成されていません',
        checkingPDF: 'PDF ステータスを確認中...',
        loadingDOCX: 'DOCX を読み込み中...',
        failedToLoad: 'コンテンツの読み込みに失敗しました。',
        copy: 'コピー',
        copied: 'コピーしました！'
    },

    // Page Viewer
    pageViewer: {
        page: 'ページ',
        noImageAvailable: '画像がありません',
        selectPageToView: '表示するページを選択してください',
        loadingImage: '画像を読み込み中...',
        status: 'ステータス',
        size: 'サイズ',
        file: 'ファイル',
        loadFailed: '読み込み失敗',
        failedToLoadImage: '画像の読み込みに失敗しました',
        fullImageNotFound: 'ストレージに完全な画像が見つかりません',
        failedToLoadFromStorage: 'ストレージからの画像読み込みに失敗しました',
        fit: 'フィット',
        showOverlay: 'オーバーレイを表示',
        hideOverlay: 'OCR オーバーレイを隠す',
        showOverlayTooltip: 'OCR オーバーレイを表示'
    },

    // OCR Queue Popover
    ocrQueue: {
        activeTasks: '実行中',
        queuedTasks: '待機中',
        noActiveTasks: 'アクティブな OCR タスクはありません',
        noQueuedTasks: 'キューに入っている OCR タスクはありません',
        queuePosition: '待機中 (#{0})',
        processing: '処理中 (#1)',
        submitting: '送信中...'
    },

    // Raw Text Panel
    rawTextPanel: {
        rawText: '生テキスト',
        copy: 'コピー',
        copied: 'コピーしました！',
        copyFailed: 'コピー失敗'
    },

    // OCR Result Overlay
    ocrResult: {
        noRecognizedText: '認識されたテキストはありません'
    },

    // Common
    common: {
        confirm: '確認',
        cancel: 'キャンセル',
        ok: 'OK',
        delete: '削除',
        export: 'エクスポート',
        close: '閉じる',
        language: '言語',
        english: 'English',
        chinese: '中文',
        traditionalChinese: '繁體中文',
        japanese: '日本語'
    },

    // Page Item
    pageItem: {
        scanToDocument: 'ドキュメントへスキャン',
        deletePage: 'ページを削除',
        outputWarning: 'OCR 結果が信頼できない可能性があります'
    },

    // OCR Queue Popover
    ocrQueuePopover: {
        title: 'OCR キュー',
        cancelSelected: '選択したタスクをキャンセル',
        cancelAll: 'すべてキャンセル',
        selectAll: 'すべて選択',
        recognizing: '認識中...',
        waiting: '待機中...',
        close: '閉じる',
        cancelTask: 'タスクをキャンセル',
        taskCancelled: 'タスクがキャンセルされました',
        tasksCancelled: '{n} 個のタスクがキャンセルされました',
        allTasksCancelled: 'すべてのタスクがキャンセルされました',
        modelLoading: 'モデル読み込み中です。準備ができ次第キューのタスクが開始されます。',
        modelError: 'モデル利用不可：{0}'
    },

    // OCR Input Modal
    ocrInputModal: {
        locateObject: 'オブジェクト位置特定',
        customPrompt: 'カスタムプロンプト',
        locatePlaceholder: '特定するオブジェクト名を入力...',
        promptPlaceholder: 'カスタムプロンプトを入力...',
        locate: '特定',
        runOCR: 'OCR 実行'
    },

    // OCR Raw Text Panel
    ocrRawTextPanel: {
        title: 'OCR 生結果',
        copy: 'コピー',
        noRawText: '生テキストがありません',
        copied: 'コピーしました！',
        copyFailed: 'コピー失敗',
        warnings: '出力チェック',
        finishReason: '終了理由',
        finishStop: '正常終了',
        finishLength: '最大長に到達（切り捨ての可能性）',
        finishRepetitionCut: '繰り返しを検出し早期停止',
        hint: 'ヒント'
    },

    // Error messages
    errors: {
        noFilesSelected: 'ファイルが選択されていません',
        unsupportedFileType: 'サポートされていないファイル形式です',
        failedToLoadMarkdown: 'Markdown の読み込みに失敗しました',
        failedToExportMarkdown: 'Markdown のエクスポートに失敗しました',
        ocrServiceUnavailable: 'OCR サービスは現在利用できません。後でもう一度お試しください。',
        ocrServiceUnavailableTitle: 'サービス利用不可',
        ocrQueueFull: 'OCR キューが満杯です。後でもう一度お試しください。',
        ocrQueueFullTitle: 'キュー満杯'
    }
} as const
