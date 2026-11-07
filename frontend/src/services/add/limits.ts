/**
 * Upload size limits - the single source of truth.
 *
 * Every size check (add service, PDF service) must reference these constants; a test
 * (limits.test.ts) scans src/ so no other `N * 1024 * 1024` limit literal creeps back in.
 */
export const BYTES_PER_MB = 1024 * 1024

export const FILE_LIMITS = {
  /**
   * PDFs: 500 MB. Safe only because the PDF bytes are read once and transferred (not copied) to the
   * render worker, which parses the document once and keeps it open for all pages. Before that
   * fix the pipeline held ~3 full copies plus one more per page, so even 100 MB was risky.
   */
  maxPdfBytes: 500 * BYTES_PER_MB,
  /** Images are stored as-is, one page each */
  maxImageBytes: 10 * BYTES_PER_MB
} as const

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MB)}MB`
}
