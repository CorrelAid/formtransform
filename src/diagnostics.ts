/**
 * Findings the validators report. Shared by every format module, so it lives
 * outside all of them.
 */

/** One finding: an `error` blocks a lossless conversion, a `warning` doesn't. */
export interface SubsetViolation {
  severity: 'error' | 'warning';
  message: string;
}
