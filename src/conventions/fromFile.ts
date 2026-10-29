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

const CODES = RULE.limesurveyCodes;
const CHOICE_RULES = conventions.conventions.sanitization.choiceCode;
const FITS = new RegExp(CHOICE_RULES.pattern);
const CODE_LENGTH: number = CHOICE_RULES.maxLength;
const ALPHABET: string = CODES.alphabet;
const SPACE = ALPHABET.length ** CODE_LENGTH;

/** 32-bit FNV-1a over the UTF-16 code units (`limesurveyCodes.hash`). */
function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** `text`'s code: its hash, written in the alphabet, padded to the length. */
function hashedCode(text: string): string {
  let n = fnv1a32(text) % SPACE;
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out = ALPHABET[n % ALPHABET.length] + out;
    n = Math.floor(n / ALPHABET.length);
  }
  return out;
}

/** Whether a vocabulary code can be a LimeSurvey answer code as it is. */
export function fitsLimeSurvey(code: string): boolean {
  return FITS.test(code) && code.length <= CODE_LENGTH;
}

/**
 * The LimeSurvey answer codes of a vocabulary's options
 * (convention:externalCodeList `limesurveyCodes`): a code that fits is kept,
 * every other one gets a code derived from the code itself, so it is the same
 * whatever the file's order and whichever rows are added or removed.
 */
export function vocabAnswerCodes(codes: readonly string[]): string[] {
  const used = new Set(
    codes.filter(fitsLimeSurvey).map((c) => c.toLowerCase()),
  );
  const assigned = new Map<string, string>();
  const derived = [...new Set(codes.filter((c) => !fitsLimeSurvey(c)))].sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const code of derived) {
    let candidate = hashedCode(code);
    for (let n = 1; used.has(candidate); n++) {
      candidate = hashedCode(`${code}${CODES.collisionSeparator}${n}`);
    }
    used.add(candidate);
    assigned.set(code, candidate);
  }
  return codes.map((c) => assigned.get(c) ?? c);
}
