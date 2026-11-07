/**
 * Single source of the user-visible release label (header badge + footer).
 * Bump here only; version.test.ts fails if a hard-coded older label remains in src/.
 */
export const APP_VERSION = '5.0'
export const MODEL_LABEL = 'OCR-2'
export const APP_VERSION_LABEL = `v${APP_VERSION} · ${MODEL_LABEL}`
