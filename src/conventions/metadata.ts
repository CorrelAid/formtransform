/**
 * `convention:unregisteredRows`: XLSForm metadata rows (`start`, `end`,
 * `today`, …) carry no question and are skipped by every emitter.
 */
import conventions from '../generated/conventions.js';

export const METADATA_ROW_TYPES: readonly string[] =
  conventions.conventions.unregisteredRows.metadataRowTypes;
