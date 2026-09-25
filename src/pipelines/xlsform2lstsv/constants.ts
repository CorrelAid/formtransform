import { TYPE_MAPPINGS } from './typeMapper.js';
import { METADATA_ROW_TYPES } from '../../conventions/metadata.js';

// Derived from registry convention:unregisteredRows — device/session metadata
// rows are silently skipped; any other unregistered type is an error.
export const SKIP_TYPES: readonly string[] = METADATA_ROW_TYPES;

// Derived from registry: registered types LimeSurvey TSV cannot express
// (supported: false) throw an error. begin_group/end_group are special-cased
// in processRow before this check.
export const UNIMPLEMENTED_TYPES: string[] = Object.entries(TYPE_MAPPINGS)
  .filter(([k, v]) => !v.supported && k !== 'begin_group' && k !== 'end_group')
  .map(([k]) => k);

/** A TSV row as the converter builds it (the serializer's row type). */
export type { TSVRow as TSVRowData } from '../../lstsv/columns.js';

// Internal state interfaces
export interface GroupStackItem {
  originalName: string;
  sanitizedName: string;
  emittedAsGroup: boolean;
}
