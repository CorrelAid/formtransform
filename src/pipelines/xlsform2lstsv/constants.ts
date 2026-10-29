import { METADATA_ROW_TYPES } from '../../conventions/metadata.js';
import type { SurveyRow } from '../../xlsform/types.js';

// Derived from registry convention:unregisteredRows — device/session metadata
// rows are silently skipped; any other unregistered type is an error.
export const SKIP_TYPES: readonly string[] = METADATA_ROW_TYPES;

/** A TSV row as the converter builds it (the serializer's row type). */
export type { TSVRow as TSVRowData } from '../../lstsv/columns.js';

// Internal state interfaces
export interface GroupStackItem {
  originalName: string;
  sanitizedName: string;
  /** The group's own XLSForm `relevant` (XPath), if any. */
  relevant?: string;
  /** The begin_group row, its `relevant` AND-ed with the enclosing groups'. */
  row: SurveyRow;
  /** Its title is out already, as a G row or as the note it became. */
  shown: boolean;
  /** Holds only a welcome/end note: never a G row, never a note (#206). */
  messageOnly?: boolean;
}
