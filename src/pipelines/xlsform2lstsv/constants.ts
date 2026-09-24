import { TYPE_MAPPINGS } from './typeMapper.js';
import conventions from '../../generated/conventions.js';

// Derived from registry convention:unregisteredRows — device/session metadata
// rows are silently skipped; any other unregistered type is an error.
export const SKIP_TYPES: string[] =
  conventions.conventions.unregisteredRows.metadataRowTypes;

// Derived from registry: registered types LimeSurvey TSV cannot express
// (supported: false) throw an error. begin_group/end_group are special-cased
// in processRow before this check.
export const UNIMPLEMENTED_TYPES: string[] = Object.entries(TYPE_MAPPINGS)
  .filter(([k, v]) => !v.supported && k !== 'begin_group' && k !== 'end_group')
  .map(([k]) => k);

// select_*_from_file has no native LimeSurvey representation, but when the
// referenced vocabulary is registered or supplied (via convert()'s fileChoices)
// we emit it as the base select with the vocabulary's options inlined + a `cdl_vocab` attribute
// recording the source vocabulary (see convention:externalCodeList).
export const FROM_FILE_BASE: Record<string, string> = {
  select_one_from_file: 'select_one',
  select_multiple_from_file: 'select_multiple',
};

// Canonical per-language "other" labels (convention:other). Used to verify an
// author's `other` choice label so the DDI round-trip (which rebuilds this
// label from the convention) stays faithful.
export const OTHER_LABELS: Record<string, string> =
  (conventions.conventions.other as { labels?: Record<string, string> })
    .labels ?? {};

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
}

// Internal state interfaces
export interface GroupStackItem {
  originalName: string;
  sanitizedName: string;
  emittedAsGroup: boolean;
}
