/**
 * `convention:externalCodeList`: `select_one_from_file <vocab>.csv` and
 * `select_multiple_from_file`. LimeSurvey gets the base select with the
 * vocabulary inlined and `cssclass="cdlvocab-<vocab>"` as provenance; DDI gets
 * `<concept vocab>`.
 */
import conventions from '../generated/conventions.js';
import { VOCABULARY_OPTIONS } from '../generated/VocabularyOptions.js';

const RULE = conventions.conventions.externalCodeList;

const SUFFIX = '_from_file';

/** `select_*_from_file` type → the base select it is emitted as. */
export const FROM_FILE_BASE: Readonly<Record<string, string>> =
  Object.fromEntries(
    RULE.appliesTo.map((t: string) => [t, t.slice(0, -SUFFIX.length)]),
  );

/** Whether an XLSForm base type is a `select_*_from_file`. */
export function isFromFileType(baseType: string): boolean {
  return baseType in FROM_FILE_BASE;
}

/** The `select_*_from_file` type for a base select (`select_one` → `select_one_from_file`). */
export function fromFileTypeFor(baseSelect: string): string {
  return baseSelect + SUFFIX;
}

/** Vocabulary id from a filename (`iso_3166_1.csv` → `iso_3166_1`). */
export function vocabFromFilename(filename: string): string {
  return filename.replace(/\.csv$/i, '');
}

/** Prefix of the LimeSurvey `cssclass` value carrying vocabulary provenance. */
export const CDLVOCAB_PREFIX: string = RULE.limesurveyCssClassPrefix;

/** The `cssclass` value recording a vocabulary. */
export function cssClassForVocab(vocab: string): string {
  return CDLVOCAB_PREFIX + vocab;
}

/** Vocabulary id from a `cssclass` value, or `''` when it carries none. */
export function vocabFromCssClass(cssclass: string): string {
  return cssclass.startsWith(CDLVOCAB_PREFIX)
    ? cssclass.slice(CDLVOCAB_PREFIX.length)
    : '';
}

/** The codes of a registered vocabulary (`iso_3166_1`), or `[]` if unknown. */
export function registeredVocabCodes(vocab: string): string[] {
  return (VOCABULARY_OPTIONS[`${vocab}.csv`] ?? []).map(([code]) => code);
}
