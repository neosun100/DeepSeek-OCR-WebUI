import { test, expect } from '../fixtures/base-test';
import type { Route } from '@playwright/test';
import { AppPage } from '../pages/AppPage';
import { PageListPage } from '../pages/PageListPage';
import { OCRPage } from '../pages/OCRPage';
import { APIMocks } from '../mocks/APIMocks';
import { TestData } from '../data/TestData';

/**
 * Backend v5 contract: /health 503 starting|error, unified error body,
 * 503 model_loading retry, page-level output warnings, and v4 error-body compatibility.
 */
test.describe('Backend v5 contract', () => {
  let app: AppPage;
  let pageList: PageListPage;
  let ocrPage: OCRPage;
  let apiMocks: APIMocks;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    pageList = new PageListPage(page);
    ocrPage = new OCRPage(page);
    apiMocks = new APIMocks(page);
  });

  async function hoverIndicator(page: import('@playwright/test').Page) {
    await page.locator('.n-badge').filter({ hasText: 'OCR Service' }).hover();
  }

  test('model starting: indicator shows loading and OCR is queued, then completes', async ({ page }) => {
    await apiMocks.mockHealth({ status: 'starting' });
    await apiMocks.mockOCR();
    await app.goto();
    await app.waitForAppReady();

    await expect.poll(() => app.getHealthStatusType(), { timeout: 10000 }).toBe('warning');
    await hoverIndicator(page);
    await expect(page.locator('.health-status')).toContainText('Model loading');

    await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
    await ocrPage.triggerOCR(0);

    // Not rejected: no "unavailable" dialog, page waits in the queue
    await expect.poll(() => ocrPage.getPageStatus(0), { timeout: 5000 }).toMatch(/pending_ocr|recognizing/);
    await expect(page.getByText('Service Unavailable')).toHaveCount(0);

    // Model becomes ready → task proceeds
    await page.unroute('**/health');
    await apiMocks.mockHealth({ status: 'healthy' });
    await ocrPage.waitForOCRSuccess(0, 30000);
  });

  test('model load error: indicator shows load_error and OCR is rejected', async ({ page }) => {
    await apiMocks.mockHealth({ status: 'error', loadError: 'weights not found (mock)' });
    await app.goto();
    await app.waitForAppReady();

    await expect.poll(() => app.getHealthStatusType(), { timeout: 10000 }).toBe('error');
    await hoverIndicator(page);
    await expect(page.locator('.health-status')).toContainText('Model unavailable');
    await expect(page.getByTestId('health-load-error')).toContainText('weights not found (mock)');

    await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
    await ocrPage.triggerOCR(0);
    await expect(page.getByText('Service Unavailable').first()).toBeVisible({ timeout: 5000 });
    expect(await ocrPage.getPageStatus(0)).toBe('ready');
  });

  test('v5 500 error body: backend message reaches the user (#39)', async ({ page }) => {
    await apiMocks.mockHealth({ status: 'healthy' });
    await apiMocks.mockOCR({ shouldFail: true, statusCode: 500, errorCode: 'internal_error', errorMessage: 'CUDA out of memory (mock v5)' });
    await app.goto();
    await app.waitForAppReady();

    await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
    await ocrPage.triggerOCR(0);

    await expect.poll(() => ocrPage.getPageStatus(0), { timeout: 15000 }).toBe('error');
    await expect(page.locator('.n-message').filter({ hasText: 'CUDA out of memory (mock v5)' }).first()).toBeVisible();
  });

  test('v4 legacy {error} body is still shown (compat)', async ({ page }) => {
    await apiMocks.mockHealth({ status: 'healthy', legacy: true });
    await apiMocks.mockOCR({ shouldFail: true, statusCode: 500, errorFormat: 'v4', errorMessage: 'legacy backend failure' });
    await app.goto();
    await app.waitForAppReady();

    await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
    await ocrPage.triggerOCR(0);

    await expect.poll(() => ocrPage.getPageStatus(0), { timeout: 15000 }).toBe('error');
    await expect(page.locator('.n-message').filter({ hasText: 'legacy backend failure' }).first()).toBeVisible();
  });

  test('v4 legacy 429 {detail: "Client at max"} still maps to Client Limit (compat)', async ({ page }) => {
    await apiMocks.mockHealth({ status: 'healthy', legacy: true });
    await apiMocks.mockOCR({ rateLimitType: 'client_limit', errorFormat: 'v4' });
    await app.goto();
    await app.waitForAppReady();

    await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
    await ocrPage.triggerOCR(0);

    await expect(page.getByText(/client.*limit|already.*task/i).first()).toBeVisible({ timeout: 10000 });
    expect(await ocrPage.getPageStatus(0)).toBe('error');
  });

  test('503 model_loading on /ocr is retried, not failed', async ({ page }) => {
    await apiMocks.mockHealth({ status: 'healthy' });
    let calls = 0;
    const success = JSON.parse((await import('fs')).readFileSync('tests/e2e/samples/sample.json', 'utf-8'));
    await page.route('**/ocr', async (route: Route) => {
      calls++;
      if (calls === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: { 'Retry-After': '1' },
          body: JSON.stringify(APIMocks.v5Error('model_loading', 'model is loading'))
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(success) });
    });
    await app.goto();
    await app.waitForAppReady();

    await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
    await ocrPage.triggerOCR(0);
    await ocrPage.waitForOCRSuccess(0, 20000);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('failing output warning shows a badge on the page item and in the raw panel', async ({ page }) => {
    await apiMocks.mockHealth({ status: 'healthy' });
    await apiMocks.mockOCR({
      warnings: [
        { code: 'repetition_cut', message: 'Tail repetition detected (mock)' },
        { code: 'near_empty', message: 'Few characters (mock)' }
      ]
    });
    await app.goto();
    await app.waitForAppReady();

    await pageList.uploadAndWaitReady([TestData.files.samplePNG()]);
    await ocrPage.triggerOCR(0);
    await ocrPage.waitForOCRSuccess(0);

    await expect(page.getByTestId('page-output-warning').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="raw-text-warning"][data-code="repetition_cut"]')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('raw-text-finish-reason')).toHaveAttribute('data-reason', 'repetition_cut');
  });
});
