import { test, expect } from '../fixtures/base-test';
import { AppPage } from '../pages/AppPage';
import { PageListPage } from '../pages/PageListPage';
import { TestData } from '../data/TestData';

test.describe('Order Integrity (Mixed Files)', () => {
  let app: AppPage;
  let pageList: PageListPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    pageList = new PageListPage(page);
    await app.goto();
    await app.clearDatabase();
    await page.reload();
    await app.waitForAppReady();
  });

  test('should maintain order: Image then PDF', async ({ browserName }) => {
    test.skip(browserName === 'webkit', 'Skip webkit due to blob issues');
    test.setTimeout(60000);

    // 1. Upload PNG
    await pageList.uploadAndWaitReady(TestData.files.samplePNG());
    expect(await pageList.getPageCount()).toBe(1);

    // 2. Upload PDF
    await pageList.uploadAndWaitReady(TestData.files.samplePDF());

    // 3. Verify Total Count
    const pageCount = await pageList.getPageCount();
    expect(pageCount).toBeGreaterThan(1);

    // 4. Verify Final Order
    const names = await pageList.getPageOrder();
    expect(names[0]).toBe('sample.png');
    for (let i = 1; i < names.length; i++) {
      expect(names[i]).toMatch(/sample_\d+\.jpg/);
    }
  });

  test('should maintain order: PDF then Image', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Skip webkit due to blob issues');
    test.setTimeout(60000);

    // 1. Upload PDF
    const [fileChooser1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('.app-header button:has-text("Import Files")')
    ]);
    await fileChooser1.setFiles(TestData.files.samplePDF());

    // Wait for PDF pages to start appearing
    await expect(async () => {
      expect(await pageList.getPageCount()).toBeGreaterThan(0);
    }).toPass({ timeout: 30000 });

    const pdfPageCount = await pageList.getPageCount();

    // 2. Immediately Upload PNG (during PDF processing)
    const [fileChooser2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('.app-header button:has-text("Import Files")')
    ]);
    await fileChooser2.setFiles(TestData.files.samplePNG());

    // 3. Verify Total Count
    const expectedTotal = pdfPageCount + 1;
    await pageList.waitForPagesLoaded({ count: expectedTotal });
    await pageList.waitForThumbnailsReady();

    // 4. Reload to verify DB sequence
    await page.reload();
    await app.waitForAppReady();
    await pageList.waitForPagesLoaded({ count: expectedTotal });

    // 5. Verify Final Order
    const names = await pageList.getPageOrder();
    for (let i = 0; i < pdfPageCount; i++) {
      expect(names[i]).toMatch(/sample_\d+\.jpg/);
    }
    expect(names[pdfPageCount]).toBe('sample.png');
  });

  test('should maintain order: Two Images (Consecutive)', async ({ page }) => {
    // 1. Upload first Image
    await pageList.uploadAndWaitReady(TestData.files.samplePNG());

    // 2. Upload second Image immediately
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('.app-header button:has-text("Import Files")')
    ]);
    await fileChooser.setFiles(TestData.files.samplePNG()); // Reuse same PNG for simplicity

    // 3. Verify order
    await pageList.waitForPagesLoaded({ count: 2 });
    await pageList.waitForThumbnailsReady();
    
    const names = await pageList.getPageOrder();
    expect(names[0]).toBe('sample.png');
    expect(names[1]).toBe('sample.png');
  });

  test('should maintain order: Mixed Batch Upload', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Skip webkit due to blob issues');
    test.setTimeout(90000);

    // Upload both together
    const files = [TestData.files.samplePNG(), TestData.files.samplePDF()];
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('.app-header button:has-text("Import Files")')
    ]);
    await fileChooser.setFiles(files);

    // Wait for pages to start appearing
    await expect(async () => {
      expect(await pageList.getPageCount()).toBeGreaterThan(1);
    }).toPass({ timeout: 30000 });

    // Wait for page count to stabilize (all pages loaded, including PDF pages)
    // This ensures we get the accurate total count before reload
    let previousCount = await pageList.getPageCount();
    let stableIterations = 0;
    
    await expect(async () => {
      const currentCount = await pageList.getPageCount();
      if (currentCount === previousCount && currentCount > 1) {
        stableIterations++;
        // Require 3 consecutive stable checks (with delays) to ensure count is truly stable
        if (stableIterations >= 3) {
          return;
        }
        await page.waitForTimeout(1000);
      } else {
        stableIterations = 0;
        previousCount = currentCount;
      }
      throw new Error(`Page count not stable: ${currentCount} (stable iterations: ${stableIterations})`);
    }).toPass({ timeout: 60000 });

    // Get the actual total count after pages have stabilized
    const totalCount = await pageList.getPageCount();
    await pageList.waitForThumbnailsReady(60000);

    // Reload to verify DB sequence
    await page.reload();
    await app.waitForAppReady();
    
    // Wait for pages to load from DB and stabilize after reload
    previousCount = 0;
    stableIterations = 0;
    
    await expect(async () => {
      const currentCount = await pageList.getPageCount();
      if (currentCount === previousCount && currentCount > 0) {
        stableIterations++;
        // Require 3 consecutive stable checks to ensure count is truly stable
        if (stableIterations >= 3) {
          return;
        }
        await page.waitForTimeout(1000);
      } else {
        stableIterations = 0;
        previousCount = currentCount;
      }
      throw new Error(`Page count not stable after reload: ${currentCount} (stable iterations: ${stableIterations})`);
    }).toPass({ timeout: 60000 });
    
    // Verify the count matches
    const reloadedCount = await pageList.getPageCount();
    expect(reloadedCount).toBe(totalCount);

    // Verify consistency
    const names = await pageList.getPageOrder();
    expect(names.some(n => n.includes('sample.png'))).toBe(true);
    const pdfPageNames = names.filter(n => /^sample_\d+\.jpg$/.test(n));
    expect(pdfPageNames.length).toBe(totalCount - 1);
  });
});
