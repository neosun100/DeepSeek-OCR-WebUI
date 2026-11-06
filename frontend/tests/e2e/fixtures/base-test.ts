import { test as base, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Known benign patterns that should be filtered out from console logs
 */
const IGNORED_PATTERNS = [
    'scroll-linked positioning effect',
    'Error resuming PDF processing',
    'Failed to save source file to DB',
    'Another connection wants to delete database',
    'legacy pages without fileId link',
    'Importing a module script failed',
    'Loading failed for the module with source',
    'WebKitBlobResource error 1',
    'NotReadableError: The I/O read operation failed',
    'due to access control checks',
    'OCR API Error: 500',
    'OCR task for page',
    'Failed to load resource: the server responded with a status of 500',
    'WebKit encountered an internal error',
    '[DeepSeekOCRProvider] Process failed', // OCR error handling tests intentionally trigger this
    '[HealthCheckService] OCR service is unavailable',
    '[HealthCheckService] OCR service is unhealthy',
    '[HealthCheckService] OCR service status', // busy/full status warnings are expected
    '[QueueManager] OCR service unavailable', // 模糊匹配，忽略变量
    '[QueueManager] OCR service recovered',
    'OCR service is currently unavailable. Please try again later.',
    'Uncaught (in promise) Error: OCR service is currently unavailable. Please try again later.',
    '[QueueManager] OCR service recovered',
    'OCR Error:',
    // Rate limiting errors (429) are expected in rate-limiting tests
    'Failed to load resource: the server responded with a status of 429',
    'Queue Full:',
    'Client Limit:',
    'IP Limit:',
    'Rate Limit Exceeded:',
    'Cross-Origin Request Blocked:',
    'CORS request did not succeed',
    'NetworkError when attempting to fetch resource.',
    'Preflight response is not successful',
    'Status code: 502',
    'Failed to load resource: Preflight response is not successful',
    'blocked by CORS policy',
    'Failed to load resource: net::ERR_FAILED',
    // v5 contract: retry / degradation logs are expected in the scenarios that trigger them
    '[OCRService] Network error for page', // fetch rejected (e.g. request cut when a test ends)
    '[OCRService] OCR model is loading',
    '[OCRService] OCR model still loading (503)',
    '[HealthCheckService] OCR model failed to load',
    'Failed to load resource: the server responded with a status of 503',
    'OCR model is unavailable:',
];

/**
 * Check if a log entry should be filtered out
 */
function shouldFilterLog(cleanText: string): boolean {
    return IGNORED_PATTERNS.some(pattern => cleanText.includes(pattern));
}

/**
 * Custom fixture that extends the base Playwright test.
 * It monitors the browser console for errors and warnings.
 * If any are found during a test, the test will fail.
 */
export const test = base.extend({
    page: async ({ page }, use) => {
        const logs: { type: string; text: string }[] = [];

        // Mock font fetch to ensure it doesn't fail in tests (which causes WinAnsi encoding errors for CJK)
        // This is applied globally to all tests that use the 'page' fixture
        await page.route('**/standard_fonts/**', async (route) => {
            const url = new URL(route.request().url());
            const filePath = path.join(process.cwd(), 'public', url.pathname);
            if (fs.existsSync(filePath)) {
                await route.fulfill({
                    status: 200,
                    body: fs.readFileSync(filePath),
                });
            } else {
                await route.continue();
            }
        });

        // Mock health check to prevent real network requests and ensure service is always "healthy" in tests
        await page.route('**/health', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 'ok',
                    queue: {
                        pending: 0,
                        processing: 0,
                        max_concurrency: 5
                    }
                }),
            });
        });

        // Listen for console messages
        page.on('console', msg => {
            const type = msg.type();
            if (type === 'error' || type === 'warning') {
                logs.push({ type, text: msg.text() });
            }
        });

        // Listen for uncaught exceptions
        page.on('pageerror', exc => {
            logs.push({ type: 'pageerror', text: exc.message });
        });

        // Run the actual test
        await use(page);

        // After test completion, assert that no errors or warnings were logged
        if (logs.length > 0) {
            // Filter out known benign warnings or environmental issues
            const filteredLogs = logs.filter(log => {
                // Remove ANSI escape codes (color formatting) for more robust matching
                // eslint-disable-next-line no-control-regex, sonarjs/no-control-regex
                const cleanText = log.text.replace(/\x1b\[[0-9;]*m/g, '');
                return !shouldFilterLog(cleanText);
            });

            if (filteredLogs.length > 0) {
                const formattedLogs = filteredLogs
                    .map(log => `[${log.type.toUpperCase()}] ${log.text}`)
                    .join('\n');

                // We use a custom message for the expectation failure
                expect(filteredLogs, `Found browser console logs during test:\n${formattedLogs}`).toHaveLength(0);
            }
        }
    },
});

export { expect };
