import type { Page, Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export class APIMocks {
  constructor(private page: Page) { }

  /** /health body; v5 fields are omitted when `legacy` (v4 backend). */
  static healthBody(status: string, opts: {
    legacy?: boolean;
    loadError?: string;
    queueInfo?: object;
    rateLimits?: object;
    yourQueueStatus?: object;
  }): Record<string, unknown> {
    const notReady = status === 'starting' || status === 'error';
    const body: Record<string, unknown> = {
      status,
      backend: 'mock-backend',
      platform: 'mock-platform',
      model_loaded: !notReady
    };
    if (!opts.legacy) {
      Object.assign(body, {
        ready: !notReady,
        version: '5.0.0',
        model_version: 'DeepSeek-OCR-2',
        engine: { engine: 'fake', device: 'mock-device', dtype: 'bfloat16' },
        load_error: status === 'error' ? (opts.loadError ?? 'mock load failure') : null,
        inflight: 0
      });
    }
    if (opts.queueInfo) body.ocr_queue = opts.queueInfo;
    if (opts.rateLimits) body.rate_limits = opts.rateLimits;
    if (opts.yourQueueStatus) body.your_queue_status = opts.yourQueueStatus;
    return body;
  }

  /** v5 error body: {success:false, detail:{error, message}, request_id} */
  static v5Error(error: string, message: string): object {
    return { success: false, detail: { error, message }, request_id: 'mock-request-id' };
  }

  /**
   * Mock OCR API
   * @param options - Mock 配置选项
   */
  async mockOCR(options: {
    delay?: number;
    response?: object;
    shouldFail?: boolean;
    statusCode?: number;
    rateLimitType?: 'queue_full' | 'client_limit' | 'ip_limit';
    /**
     * Error body generation. 'v5' (default): {success:false, detail:{error, message}, request_id};
     * 'v4': legacy {detail: "..."} for 429 and {error: "..."} for other failures.
     */
    errorFormat?: 'v5' | 'v4';
    errorCode?: string;
    errorMessage?: string;
    /** v5 output-check warnings attached to the default success response */
    warnings?: Array<{ code: string; message: string }>;
  } = {}) {
    const {
      delay = 0,
      response,
      shouldFail = false,
      statusCode = shouldFail ? 500 : 200,
      rateLimitType,
      errorFormat = 'v5',
      errorCode = 'internal_error',
      errorMessage = 'OCR service unavailable',
      warnings
    } = options;

    await this.page.route('**/ocr', async (route: Route) => {
      // 模拟网络延迟
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // 模拟速率限制 (429)
      if (rateLimitType) {
        // v5 messages keep the v4 phrases ("queue full" / "Client at max" / "IP at max")
        const detailMessages = {
          queue_full: 'OCR queue full, please retry later',
          client_limit: 'Client at max concurrent requests',
          ip_limit: 'IP at max concurrent requests'
        };
        const legacyMessages = {
          queue_full: 'queue full',
          client_limit: 'Client at max',
          ip_limit: 'IP at max'
        };
        const body = errorFormat === 'v4'
          ? { detail: legacyMessages[rateLimitType] }
          : APIMocks.v5Error(rateLimitType, detailMessages[rateLimitType]);
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify(body)
        });
        return;
      }

      // 模拟失败
      if (shouldFail) {
        const body = errorFormat === 'v4'
          ? { success: false, error: errorMessage }
          : APIMocks.v5Error(errorCode, errorMessage);
        await route.fulfill({
          status: statusCode,
          contentType: 'application/json',
          body: JSON.stringify(body)
        });
        return;
      }

      // 使用默认或自定义响应
      const mockResponse = response || this.loadDefaultOCRResponse(warnings);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponse)
      });
    });
  }

  /**
   * Mock Health API
   * @param options - Health Mock 配置
   */
  async mockHealth(options: {
    /** 'starting' / 'error' answer HTTP 503 with a v5 body (model loading / load failed) */
    status: 'healthy' | 'busy' | 'full' | 'unhealthy' | 'starting' | 'error';
    delay?: number;
    shouldFail?: boolean;
    loadError?: string;
    /** Emit the v4 body only (no version / engine / ready fields) */
    legacy?: boolean;
    queueInfo?: {
      depth: number;
      max_size: number;
      is_full: boolean;
    };
    rateLimits?: {
      max_per_client: number;
      max_per_ip: number;
      active_clients: number;
      active_ips: number;
    };
    yourQueueStatus?: {
      client_id: string;
      position: number | null;
      total_queued: number;
    };
  } = { status: 'healthy' }) {
    const { status, delay = 0, shouldFail = false, queueInfo, rateLimits, yourQueueStatus, loadError, legacy = false } = options;

    await this.page.route('**/health', async (route: Route) => {
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      if (shouldFail) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' })
        });
        return;
      }

      const notReady = status === 'starting' || status === 'error';
      const mockResponse = APIMocks.healthBody(status, { legacy, loadError, queueInfo, rateLimits, yourQueueStatus });

      await route.fulfill({
        status: notReady ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponse)
      });
    });
  }

  /**
   * Mock OCR API 带延迟控制(用于复杂测试场景)
   * @param completeFlag - 控制 Mock 完成的标志对象
   */
  async mockOCRWithControl(completeFlag: { value: boolean }) {
    await this.page.route('**/ocr', async (route: Route) => {
      // 等待 flag 变为 true
      while (!completeFlag.value) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const mockResponse = this.loadDefaultOCRResponse();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponse)
      });
    });
  }

  /**
   * 移除所有 OCR mocks
   */
  async unmockOCR() {
    await this.page.unroute('**/ocr');
  }

  /**
   * 加载默认 OCR 响应
   */
  private loadDefaultOCRResponse(warnings: Array<{ code: string; message: string }> = []): object {
    const responsePath = path.resolve('tests/e2e/samples/sample.json');
    if (fs.existsSync(responsePath)) {
      const sample = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
      // v5 contract fields on top of the recorded v4 sample
      const failing = ['repetition', 'repetition_cut', 'truncated', 'coordinate_loop', 'empty_output'];
      return {
        ...sample,
        ok: !warnings.some(w => failing.includes(w.code)),
        finish_reason: warnings.some(w => w.code === 'repetition_cut') ? 'repetition_cut' : 'stop',
        warnings,
        content_chars: (sample.text || '').length,
        request_id: 'mock-request-id'
      };
    }

    // 返回默认的 OCR 响应结构
    return {
      regions: [
        {
          lines: [
            {
              words: [
                { text: 'Sample Text', confidence: 0.95 }
              ]
            }
          ]
        }
      ]
    };
  }

  /**
   * Mock 字体文件请求
   */
  async mockFonts() {
    await this.page.route('**/standard_fonts/**', async (route) => {
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
  }

  /**
   * Mock OCR API with Client ID validation
   * @param onValidate - Callback function to validate client ID
   */
  async mockOCRWithClientIdValidation(
    onValidate: (clientId: string | null) => void
  ) {
    await this.page.route('**/ocr', async (route: Route) => {
      const headers = route.request().headers();
      const clientId = headers['x-client-id'] || null;
      onValidate(clientId); // Call validation callback

      const mockResponse = this.loadDefaultOCRResponse();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockResponse)
      });
    });
  }

  /**
   * Mock 导出 API
   */
  async mockExport(options: {
    shouldFail?: boolean;
    statusCode?: number;
  } = {}) {
    const { shouldFail = false, statusCode = shouldFail ? 500 : 200 } = options;

    await this.page.route('**/export/**', async (route: Route) => {
      if (shouldFail) {
        await route.fulfill({
          status: statusCode,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Export failed' })
        });
        return;
      }

      await route.continue();
    });
  }
}
