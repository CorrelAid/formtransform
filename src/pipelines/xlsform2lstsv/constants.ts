import { METADATA_ROW_TYPES } from '../../conventions/metadata.js';

// Derived from registry convention:unregisteredRows — device/session metadata
// rows are silently skipped; any other unregistered type is an error.
export const SKIP_TYPES: readonly string[] = METADATA_ROW_TYPES;

/** A TSV row as the converter builds it (the serializer's row type). */
export type { TSVRow as TSVRowData } from '../../lstsv/columns.js';

// Internal state interfaces
export interface GroupStackItem {
  originalName: string;
  sanitizedName: string;
  emittedAsGroup: boolean;
  /** The group's own XLSForm `relevant` (XPath), if any. */
  relevant?: string;
}
