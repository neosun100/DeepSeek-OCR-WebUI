import { test, expect } from '../fixtures/base-test';
import { AppPage } from '../pages/AppPage';
import { PageListPage } from '../pages/PageListPage';
import { PageViewerPage } from '../pages/PageViewerPage';
import { OCRPage } from '../pages/OCRPage';
import { APIMocks } from '../mocks/APIMocks';
import { TestData } from '../data/TestData';

type OCRPromptType = 'document' | 'ocr' | 'free' | 'figure' | 'describe' | 'find' | 'freeform';

test.describe('OCR Mode Selector - Direct Modes', () => {
    let app: AppPage;
    let pageList: PageListPage;
    let pageViewer: PageViewerPage;
    let ocrPage: OCRPage;
    let apiMocks: APIMocks;

    test.beforeEach(async ({ page }) => {
        app = new AppPage(page);
        pageList = new PageListPage(page);
        pageViewer = new PageViewerPage(page);
        ocrPage = new OCRPage(page);
        apiMocks = new APIMocks(page);

        // Default to healthy status
        await apiMocks.mockHealth({ status: 'healthy' });
        await app.goto();
        await app.waitForAppReady();
    });

    // Test Case 1: All Direct Modes Selection (Healthy State)
    const directModes: OCRPromptType[] = ['document', 'ocr', 'free', 'figure', 'describe'];

    for (const mode of directModes) {
        test(`should trigger OCR for ${mode} mode when healthy`, async () => {
            // Upload and select a page
            await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
            await pageList.clickPage(0);

            // Wait for page viewer to be ready
            await pageViewer.waitForReady();

            // Mock OCR API with success response (longer delay to catch intermediate states)
            await apiMocks.mockOCR({ delay: 1500 });

            // Trigger the OCR mode
            if (mode === 'document') {
                // Default mode, click main button
                await pageViewer.clickOCRModeMainButton();
            } else {
                // Select from dropdown
                await pageViewer.selectOCRMode(mode);
            }

            // Verify OCR is triggered and status changes to recognizing
            await expect.poll(async () => await ocrPage.getPageStatus(0), {
                timeout: 5000
            }).toBe('recognizing');

            // Wait for OCR to complete
            await ocrPage.waitForOCRSuccess(0, 10000);

            // Verify page status is success (could be ocr_success, pending_gen, or completed)
            const status = await ocrPage.getPageStatus(0);
            expect(status).toMatch(/ocr_success|pending_gen|completed/);
        });
    }

    // Test Case 2: Queue Full Error for All Direct Modes
    for (const mode of directModes) {
        test(`should show queue full error for ${mode} mode`, async ({ page }) => {
            // Upload and select a page
            await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
            await pageList.clickPage(0);

            // Wait for page viewer to be ready
            await pageViewer.waitForReady();

            // Mock health API to show full status
            await apiMocks.mockHealth({
                status: 'full',
                queueInfo: { depth: 10, max_size: 10, is_full: true }
            });

            // Wait for health check to update
            await page.waitForTimeout(7000);

            // Trigger the OCR mode
            if (mode === 'document') {
                await pageViewer.clickOCRModeMainButton();
            } else {
                await pageViewer.selectOCRMode(mode);
            }

            // Verify error dialog appears
            await expect(page.getByText('Queue Full', { exact: true })).toBeVisible({ timeout: 3000 });
            await expect(page.getByText('OCR queue is full')).toBeVisible();

            // Close the error dialog
            await page.getByRole('button', { name: 'OK', exact: true }).click();

            // Verify page status is still ready (task not submitted)
            const status = await ocrPage.getPageStatus(0);
            expect(status).toBe('ready');
        });
    }

    // Test Case 4: Mode Switching and Persistence
    test('should persist selected mode and switch correctly', async ({ page, browserName }) => {
        // Skip on Firefox due to timeout issues with dropdown
        test.skip(browserName === 'firefox', 'Timeout issues with dropdown on Firefox');

        // Upload and select a page
        await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
        await pageList.clickPage(0);

        // Wait for page viewer to be ready
        await pageViewer.waitForReady();

        const trigger = page.getByTestId('ocr-trigger-btn');
        // Requests must be mocked before the first selection: selecting a
        // mode from the dropdown runs OCR immediately (OCRModeSelector emits
        // 'run' on select). Previously the mock was registered afterwards, so
        // that first run went to the real network.
        // The mock answers prompt_type 'document', so every run continues
        // into the doc-generation pipeline (markdown -> docx -> pdf).
        await apiMocks.mockOCR({ delay: 1500 });

        // Verify default is "Scan to Document"
        await expect(trigger).toContainText('Scan to Document');

        // Root cause of the old flake: the next interaction started after
        // waitForOCRSuccess, i.e. while doc generation was still running. The
        // selector is disabled then, except in short gaps where the status
        // reads 'completed' mid-pipeline; a click in such a gap is swallowed
        // (menu never opens), and a run started there gets its status
        // overwritten by the previous pipeline. Under full-suite CPU load the
        // pipeline is slow enough to hit this. Each step therefore waits for
        // that run's generation to finish completely.
        const runAndSettle = async (action: () => Promise<void>) => {
            const doneBefore = await ocrPage.getGenerationDoneCount(0);
            await action();
            await expect.poll(async () => await ocrPage.getPageStatus(0), {
                timeout: 5000
            }).toBe('recognizing');
            await ocrPage.waitForGenerationDone(0, doneBefore);
        };

        // Selecting "General OCR" runs OCR and updates the label
        await runAndSettle(() => pageViewer.selectOCRMode('ocr'));
        await expect(trigger).toContainText('General OCR');

        // Main button re-runs with the persisted mode, not the default
        await runAndSettle(() => pageViewer.clickOCRModeMainButton());
        await expect(trigger).toContainText('General OCR');

        // Switching to "Parse Figure" runs it and becomes the new main action
        await runAndSettle(() => pageViewer.selectOCRMode('figure'));
        await expect(trigger).toContainText('Parse Figure');
    });
});
