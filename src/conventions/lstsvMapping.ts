/**
 * `convention:lstsvMapping`: the side-car that records how xlsform2lstsv
 * renamed a form for LimeSurvey (names and answer codes outside its limits),
 * so the way back (lstsv2ddi, its `--data`, lstsv2xlsform) restores the
 * XLSForm's own names and codes.
 */
import conventions from '../generated/conventions.js';
import { ConversionError } from '../diagnostics.js';

const RULE = conventions.conventions.lstsvMapping;

/** The `format` value a mapping file carries. */
export const MAPPING_FORMAT: string = RULE.format;

/** The version this library writes and reads. */
export const MAPPING_VERSION: number = RULE.version;

/** Suffix of the side-car beside the TSV (`survey.tsv` → `survey.mapping.json`). */
export const MAPPING_FILE_SUFFIX: string = RULE.fileSuffix;

/** How a conversion renamed a form for LimeSurvey. */
export interface LstsvMapping {
  format: string;
  version: number;
  /** LimeSurvey name → XLSForm name, where they differ. */
  names: Record<string, string>;
  /**
   * LimeSurvey question (or grid) name → { LimeSurvey answer code → XLSForm
   * choice name }, where they differ.
   */
  codes: Record<string, Record<string, string>>;
}

/** A mapping that renames nothing. */
export function emptyMapping(): LstsvMapping {
  return {
    format: MAPPING_FORMAT,
    version: MAPPING_VERSION,
    names: {},
    codes: {},
  };
}

/** Whether the mapping renames nothing. */
export function isEmptyMapping(m: LstsvMapping): boolean {
  return Object.keys(m.names).length === 0 && Object.keys(m.codes).length === 0;
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === 'string');

/**
 * Read a mapping (its JSON text or the parsed object), checking its shape.
 * Throws `mapping-invalid` on anything else.
 */
export function parseLstsvMapping(source: unknown): LstsvMapping {
  const invalid = (why: string) =>
    new ConversionError('mapping-invalid', `Not a LimeSurvey mapping: ${why}`);
  let value: unknown = source;
  if (typeof source === 'string') {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw invalid((error as Error).message);
    }
  }
  if (typeof value !== 'object' || value === null) throw invalid('no object');
  const m = value as Partial<LstsvMapping>;
  if (m.format !== MAPPING_FORMAT) {
    throw invalid(`format is not "${MAPPING_FORMAT}"`);
  }
  if (m.version !== MAPPING_VERSION) {
    throw invalid(
      `version ${String(m.version)} (this library reads ${MAPPING_VERSION})`,
    );
  }
  if (!isStringRecord(m.names)) throw invalid('"names" is no name map');
  if (
    typeof m.codes !== 'object' ||
    m.codes === null ||
    !Object.values(m.codes).every(isStringRecord)
  ) {
    throw invalid('"codes" is no code map per question');
  }
  return {
    format: m.format,
    version: m.version,
    names: m.names,
    codes: m.codes,
  };
}
