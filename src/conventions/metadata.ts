/**
 * `convention:unregisteredRows`: XLSForm metadata rows (`start`, `end`,
 * `today`, …) carry no question. LimeSurvey skips them; the DDI keeps them
 * as `cdl:row` notes (#160), without a variable.
 */
import conventions from '../generated/conventions.js';

export const METADATA_ROW_TYPES: readonly string[] =
  conventions.conventions.unregisteredRows.metadataRowTypes;

const METADATA = new Set(METADATA_ROW_TYPES);

/** A metadata row's type (`start`, `deviceid`, …). */
export function isMetadataType(type: string): boolean {
  return METADATA.has(type);
}
