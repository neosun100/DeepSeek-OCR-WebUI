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
        // Skip on Chromium and Webkit due to CORS 502 errors in console
        // Skip on Firefox due to timeout issues with dropdown
        test.skip(browserName === 'firefox', 'Timeout issues with dropdown on Firefox');

        // Upload and select a page
        await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
        await pageList.clickPage(0);

        // Wait for page viewer to be ready
        await pageViewer.waitForReady();

        // Verify default is "Scan to Document"
        const defaultLabel = await pageViewer.getCurrentModeLabel();
        expect(defaultLabel).toContain('Scan to Document');

        // The mode buttons stay disabled until doc generation ends, so each run waits for 'completed'.
        // Mock OCR BEFORE selecting: picking a mode from the dropdown already runs OCR.
        // Previously that first request was unmocked and went to the real dev API
        // (DEV_API_BASE_URL); with v5 network-error retries (issue #47) that made this test
        // depend on the external server.
        await apiMocks.mockOCR({ delay: 1500 });
        const promptTypes: string[] = [];
        page.on('request', req => {
            if (!req.url().endsWith('/ocr') || req.method() !== 'POST') return;
            const m = /name="prompt_type"\r\n\r\n([a-z]+)/.exec(req.postData() || '');
            if (m?.[1]) promptTypes.push(m[1]);
        });

        // Select "General OCR" from dropdown → runs OCR in 'ocr' mode
        await pageViewer.selectOCRMode('ocr');
        await expect.poll(() => promptTypes, { timeout: 5000 }).toEqual(['ocr']);
        await expect.poll(() => ocrPage.getPageStatus(0), { timeout: 30000 }).toBe('completed');

        // Verify the label changed to "General OCR"
        const updatedLabel = await pageViewer.getCurrentModeLabel();
        expect(updatedLabel).toContain('General OCR');

        // Click main button (should reuse the persisted 'ocr' mode, not 'document')
        await pageViewer.clickOCRModeMainButton();
        await expect.poll(() => promptTypes, { timeout: 5000 }).toEqual(['ocr', 'ocr']);
        await expect.poll(() => ocrPage.getPageStatus(0), { timeout: 30000 }).toBe('completed');

        // Now switch to "Parse Figure"
        await pageViewer.selectOCRMode('figure');
        await expect.poll(() => promptTypes, { timeout: 5000 }).toEqual(['ocr', 'ocr', 'figure']);

        // Should show figure mode
        const finalLabel = await pageViewer.getCurrentModeLabel();
        expect(finalLabel).toContain('Parse Figure');
        await expect.poll(() => ocrPage.getPageStatus(0), { timeout: 30000 }).toBe('completed');
    });
});
