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

// TSV row data interface
export interface TSVRowData {
  class: string;
  'type/scale': string;
  name: string;
  relevance: string;
  text: string;
  help: string;
  language: string;
  validation: string;
  em_validation_q: string;
  mandatory: string;
  other: string;
  default: string;
  same_default: string;
  hidden?: string;
  cssclass?: string;
  hide_tip?: string;
  date_format?: string;
  min_num_value_n?: string;
  max_num_value_n?: string;
  num_value_int_only?: string;
  exclude_all_others?: string;
}

// Internal state interfaces
export interface GroupStackItem {
  originalName: string;
  sanitizedName: string;
  emittedAsGroup: boolean;
}
