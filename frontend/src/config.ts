export interface AppConfig {
    apiBaseUrl: string
}

/**
 * Default API base URL: '' means same origin.
 * - Production: the frontend is served by the backend itself.
 * - Development (`npm run dev`): requests go to the Vite dev server, which
 *   proxies /api, /ocr and /health to VITE_DEV_PROXY_TARGET
 *   (default http://127.0.0.1:8001, see vite.config.ts).
 * There is deliberately no hosted fallback: a third-party default would ship
 * every document a developer tests with to a server they did not choose.
 */
const DEFAULT_API_BASE_URL = ''

/**
 * Resolve the API base URL. VITE_API_BASE_URL (build-time env, e.g. CI or a
 * local .env file) overrides the same-origin default in every mode.
 */
export function resolveApiBaseUrl(env: Record<string, unknown>): string {
    const override = env.VITE_API_BASE_URL
    return typeof override === 'string' && override ? override : DEFAULT_API_BASE_URL
}

export const config: AppConfig = {
    apiBaseUrl: resolveApiBaseUrl(import.meta.env),
}
