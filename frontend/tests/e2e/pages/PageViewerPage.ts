import { expect, type Page } from '@playwright/test';

type OCRPromptType = 'document' | 'ocr' | 'free' | 'figure' | 'describe' | 'find' | 'freeform';

export class PageViewerPage {
  constructor(private page: Page) { }

  /**
   * 获取页面查看器容器
   */
  private get container() {
    return this.page.locator('.page-viewer-container');
  }

  /**
   * 获取当前显示的图片
   */
  private get currentImage() {
    return this.container.locator('.page-image');
  }

  /**
   * 等待图片加载完成
   */
  async waitForImageLoaded() {
    await this.currentImage.waitFor({ state: 'visible' });
  }

  /**
   * 检查是否显示"选择页面"提示
   */
  async isSelectPagePromptVisible(): Promise<boolean> {
    return await this.page.locator('.select-page-prompt').isVisible();
  }

  /**
   * 获取当前页面状态文本
   */
  async getStatusText(): Promise<string> {
    return await this.page.locator('.status-text').textContent() || '';
  }

  /**
   * 检查查看器是否可见
   */
  async isVisible(): Promise<boolean> {
    return await this.container.isVisible();
  }

  /**
   * 获取当前显示的图片 URL
   */
  async getCurrentImageUrl(): Promise<string | null> {
    return await this.currentImage.getAttribute('src');
  }

  /**
   * 等待查看器就绪
   */
  async waitForReady(timeout: number = 10000) {
    await this.container.waitFor({ state: 'visible', timeout });
  }

  /**
   * 点击适应按钮
   */
  async clickFitButton() {
    await this.page.locator('.fit-button').click();
  }

  /**
   * 点击缩放按钮
   */
  async clickZoomIn() {
    await this.page.locator('.zoom-in-button').click();
  }

  async clickZoomOut() {
    await this.page.locator('.zoom-out-button').click();
  }

  /**
   * 获取当前缩放级别
   */
  async getZoomLevel(): Promise<number> {
    return await this.page.evaluate(() => {
      const img = document.querySelector('.page-image') as HTMLImageElement;
      if (!img) return 1;
      const transform = window.getComputedStyle(img).transform;
      if (transform === 'none') return 1;
      const matrix = transform.match(/matrix\(([^)]+)\)/);
      if (!matrix) return 1;
      const values = matrix[1].split(',');
      return parseFloat(values[0]);
    });
  }

  // ===== OCRModeSelector Methods =====

  /**
   * Click the main OCR mode button (triggers currently selected mode)
   */
  async clickOCRModeMainButton() {
    await this.page.getByTestId('ocr-trigger-btn').click();
  }

  /**
   * Click the OCR mode dropdown arrow
   */
  async clickOCRModeDropdown() {
    await this.page.getByTestId('ocr-mode-dropdown').click();
  }

  /**
   * Get the current selected mode label text
   */
  async getCurrentModeLabel(): Promise<string> {
    const button = this.page.getByTestId('ocr-trigger-btn');
    return await button.textContent() || '';
  }

  /**
   * Select OCR mode from dropdown menu
   * @param mode - One of: 'document', 'ocr', 'free', 'figure', 'describe', 'find', 'freeform'
   */
  async selectOCRMode(mode: OCRPromptType) {
    // Map mode to UI display text (English)
    const modeTextMap: Record<OCRPromptType, string> = {
      document: 'Scan to Document',
      ocr: 'General OCR',
      free: 'Extract Raw Text',
      figure: 'Parse Figure',
      describe: 'Describe Image',
      find: 'Locate Object',
      freeform: 'Custom Prompt'
    };

    // The trigger is disabled while the page is processing (recognizing,
    // pending_gen, generating_*). Callers must first wait for the page to
    // settle (OCRPage.waitForPageStatus): a click that lands in a transient
    // enabled window (e.g. ocr_success -> pending_gen) is swallowed once
    // Vue re-renders the button disabled, and the menu never opens.
    await expect(this.page.getByTestId('ocr-mode-dropdown')).toBeEnabled();
    await this.clickOCRModeDropdown();

    // Scope to the menu so the trigger button's own label is never matched;
    // the locator click auto-waits for the option to be visible and stable.
    const dropdownMenu = this.page.locator('.n-dropdown-menu');
    const menuItem = dropdownMenu.getByText(modeTextMap[mode], { exact: true });
    await menuItem.click();

    // Menu closed. The trigger label is not asserted here: when the queue is
    // full or the service is unhealthy the selection is rejected on purpose.
    await expect(dropdownMenu).toBeHidden();
  }

  /**
   * Check if OCR mode selector is disabled
   */
  async isOCRModeSelectorDisabled(): Promise<boolean> {
    const button = this.page.getByTestId('ocr-trigger-btn');
    return await button.isDisabled();
  }

  /**
   * Check if OCR mode selector is in loading state
   */
  async isOCRModeSelectorLoading(): Promise<boolean> {
    const button = this.page.getByTestId('ocr-trigger-btn');
    const loadingIcon = button.locator('.n-spin');
    return await loadingIcon.isVisible().catch(() => false);
  }

  // ===== OCRInputModal Methods =====

  /**
   * Check if OCRInputModal is visible
   */
  async isInputModalVisible(): Promise<boolean> {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    return await modal.isVisible().catch(() => false);
  }

  /**
   * Get the input modal title
   */
  async getInputModalTitle(): Promise<string> {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    const title = modal.locator('.n-dialog__title');
    return await title.textContent() || '';
  }

  /**
   * Type text in the input modal
   */
  async typeInInputModal(text: string) {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    const textarea = modal.locator('textarea');
    await textarea.fill(text);
  }

  /**
   * Get the current value in input modal
   */
  async getInputModalValue(): Promise<string> {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    const textarea = modal.locator('textarea');
    return await textarea.inputValue();
  }

  /**
   * Get the placeholder text of input modal
   */
  async getInputModalPlaceholder(): Promise<string> {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    const textarea = modal.locator('textarea');
    return await textarea.getAttribute('placeholder') || '';
  }

  /**
   * Click the submit button in input modal
   */
  async clickInputModalSubmit() {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    const submitButton = modal.locator('.n-button--primary-type').filter({ hasText: /Locate|Run OCR/i });
    await submitButton.click();
  }

  /**
   * Get the submit button text
   */
  async getInputModalSubmitButtonText(): Promise<string> {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    const submitButton = modal.locator('.n-button--primary-type').filter({ hasText: /Locate|Run OCR/i });
    return await submitButton.textContent() || '';
  }

  /**
   * Check if submit button is enabled
   */
  async isInputModalSubmitEnabled(): Promise<boolean> {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    const submitButton = modal.locator('.n-button--primary-type').filter({ hasText: /Locate|Run OCR/i });
    return await submitButton.isEnabled();
  }

  /**
   * Click the cancel button in input modal
   */
  async clickInputModalCancel() {

    // Click the modal mask to close
    const mask = this.page.locator('.n-modal-mask');
    await mask.click({ position: { x: 10, y: 10 } });
  }

  /**
   * Wait for input modal to close
   */
  async waitForInputModalClose(timeout: number = 5000) {
    const modal = this.page.locator('.n-dialog').filter({ hasText: /Locate Object|Custom Prompt/i });
    await modal.waitFor({ state: 'hidden', timeout });
  }
}

