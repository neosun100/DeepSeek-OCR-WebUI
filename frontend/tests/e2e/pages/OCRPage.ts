import type { Page } from '@playwright/test';

export class OCRPage {
  constructor(private page: Page) {}

  /**
   * 等待 OCR 成功
   */
  async waitForOCRSuccess(pageIndex: number, timeout: number = 30000) {
    await this.page.waitForFunction(
      (idx) => {
        const pages = window.pagesStore?.pages || [];
        const status = pages[idx]?.status;
        return ['ocr_success', 'pending_gen', 'generating_markdown', 
                'markdown_success', 'generating_pdf', 'pdf_success', 
                'generating_docx', 'completed'].includes(status || '');
      },
      pageIndex,
      { timeout }
    );
  }

  /**
   * Number of fully finished document-generation runs for a page
   * (the store logs "Generated all successfully" once per run).
   */
  async getGenerationDoneCount(pageIndex: number): Promise<number> {
    return await this.page.evaluate((idx) => {
      const logs = window.pagesStore?.pages?.[idx]?.logs || [];
      return logs.filter(l => l.message === 'Generated all successfully').length;
    }, pageIndex);
  }

  /**
   * Wait until the document-generation pipeline started after OCR has fully
   * finished, i.e. the done-count rises above `previousCount`.
   *
   * Why not a status check: page status is not monotonic during generation.
   * 'completed' is reported when the run starts (doc:gen:start 'all' falls
   * back to 'completed') and again after DOCX, while PDF is still pending.
   * The OCR mode selector is enabled in those gaps, so interacting with it
   * there races with the next status update.
   */
  async waitForGenerationDone(pageIndex: number, previousCount: number, timeout: number = 30000) {
    await this.page.waitForFunction(
      ({ idx, prev }) => {
        const logs = window.pagesStore?.pages?.[idx]?.logs || [];
        return logs.filter(l => l.message === 'Generated all successfully').length > prev;
      },
      { idx: pageIndex, prev: previousCount },
      { timeout }
    );
  }

  /**
   * 等待所有页面 OCR 完成
   */
  async waitForAllOCRComplete(timeout: number = 60000) {
    await this.page.waitForFunction(
      () => {
        const pages = window.pagesStore?.pages || [];
        return pages.every(p =>
          ['ocr_success', 'pending_gen', 'generating_markdown', 
           'markdown_success', 'generating_pdf', 'pdf_success', 
           'generating_docx', 'completed'].includes(p.status)
        );
      },
      { timeout }
    );
  }

  /**
   * 获取页面 OCR 状态
   */
  async getPageStatus(pageIndex: number): Promise<string> {
    return await this.page.evaluate((idx) => {
      const pages = window.pagesStore?.pages || [];
      return pages[idx]?.status || '';
    }, pageIndex);
  }

  /**
   * 检查是否有页面在 OCR 队列中
   */
  async hasProcessingPages(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const pages = window.pagesStore?.pages || [];
      return pages.some(p => 
        p.status === 'pending_ocr' || p.status === 'recognizing'
      );
    });
  }

  /**
   * 获取正在处理的页面数量
   */
  async getProcessingPagesCount(): Promise<number> {
    return await this.page.evaluate(() => {
      const pages = window.pagesStore?.pages || [];
      return pages.filter(p => 
        p.status === 'pending_ocr' || p.status === 'recognizing'
      ).length;
    });
  }

  /**
   * 触发单个页面的 OCR
   */
  async triggerOCR(pageIndex: number) {
    // 先点击页面选中
    const pageItem = this.page.locator('[data-testid^="page-item-"]').nth(pageIndex);
    const pageId = await pageItem.getAttribute('data-page-id');
    await pageItem.click();
    
    // 等待 PageViewer 上下文切换到正确的页面
    await this.page.waitForFunction((id) => {
      const viewer = document.querySelector('[data-testid="page-viewer"]');
      return viewer?.dataset?.currentPageId === id;
    }, pageId, { timeout: 5000 });
    
    // 点击 OCR 按钮
    const ocrButton = this.page.getByTestId('ocr-trigger-btn');
    await ocrButton.waitFor({ state: 'visible', timeout: 5000 });
    await ocrButton.click();
  }

  /**
   * 检查页面是否已完成 OCR
   */
  async isOCRCompleted(pageIndex: number): Promise<boolean> {
    const status = await this.getPageStatus(pageIndex);
    return ['ocr_success', 'pending_gen', 'generating_markdown', 
            'markdown_success', 'generating_pdf', 'pdf_success', 
            'generating_docx', 'completed'].includes(status);
  }

  /**
   * 获取所有页面的 OCR 状态
   */
  async getAllPageStatuses(): Promise<string[]> {
    return await this.page.evaluate(() => {
      const pages = window.pagesStore?.pages || [];
      return pages.map(p => p.status);
    });
  }
}
