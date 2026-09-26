/**
 * @file Utility functions for handling multiple language support in XLSForms
 */
import { THREE_LETTER_LANGUAGES } from '../conventions/language.js';

/**
 * Common language codes based on IANA language subtag registry
 * This is a subset of valid 2-letter language codes for validation purposes
 */
const VALID_LANGUAGE_CODES = new Set([
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bh',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'no',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh',
  'zu',
]);

/**
 * A BCP 47 language tag, loosely: a 2–3 letter language, then optional
 * subtags (script, region, variants). {@link isValidLanguageCode} checks it.
 */
const TAG = String.raw`[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*`;
const PAREN_TAG = new RegExp(String.raw`\(\s*(${TAG})\s*\)\s*$`);
const BARE_TAG = new RegExp(String.raw`^\s*(${TAG})\s*$`);

/**
 * Canonical case for a BCP 47 tag: language lower, script title, region
 * upper, variants lower (`PT-br` → `pt-BR`, `zh-hans` → `zh-Hans`).
 */
export function normalizeLanguageTag(tag: string): string {
  return tag
    .trim()
    .split('-')
    .map((part, i) => {
      if (i === 0) return part.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(part) && i === 1) {
        return part[0].toUpperCase() + part.slice(1).toLowerCase();
      }
      if (/^([A-Za-z]{2}|\d{3})$/.test(part)) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join('-');
}

/**
 * The language tag in a name like `English (en)` or `Français (fr-BE)`, or a
 * bare tag like `fr-BE`; normalized. `null` for a bare name (`English`).
 */
export function languageTagOf(text: string): string | null {
  const m = PAREN_TAG.exec(text) ?? BARE_TAG.exec(text);
  return m ? normalizeLanguageTag(m[1]) : null;
}

/**
 * Extract the language tag from a column header: `label::English (en)` →
 * `en`, `label::fr-BE` → `fr-BE`.
 */
export function extractLanguageCode(header: string): string | null {
  const at = header.indexOf('::');
  if (at < 0) return null;
  return languageTagOf(header.slice(at + 2));
}

/**
 * Extract base column name from language-specific header (e.g., "label::English (en)" -> "label")
 */
export function extractBaseColumnName(header: string): string {
  // Remove everything after ::
  return header.split('::')[0].trim();
}

/**
 * Get all language codes from headers
 */
export function getLanguageCodesFromHeaders(headers: string[]): string[] {
  const languageCodes = new Set<string>();

  for (const header of headers) {
    const code = extractLanguageCode(header);
    if (code) {
      languageCodes.add(code);
    }
  }

  return Array.from(languageCodes);
}

/**
 * Get language-specific value from row for a given base column and language code
 */
export function getLanguageSpecificValue(
  row: Record<string, unknown>,
  baseColumn: string,
  languageCode: string,
): string | undefined {
  for (const [key, value] of Object.entries(row)) {
    const headerCode = extractLanguageCode(key);
    const headerBase = extractBaseColumnName(key);

    if (headerBase === baseColumn && headerCode === languageCode) {
      return value as string;
    }
  }
  return undefined;
}

/**
 * Get all language-specific values for a base column
 */
export function getAllLanguageValues(
  row: Record<string, unknown>,
  baseColumn: string,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(row)) {
    const headerCode = extractLanguageCode(key);
    const headerBase = extractBaseColumnName(key);

    if (headerBase === baseColumn && headerCode && value) {
      result[headerCode] = value as string;
    }
  }

  return result;
}

/**
 * Check if a header is language-specific
 */
export function isLanguageSpecificHeader(header: string): boolean {
  return extractLanguageCode(header) !== null;
}

/**
 * Whether `code` is a well-formed BCP 47 tag whose language is known: a
 * registered 2-letter ISO 639-1 code, or a 3-letter one LimeSurvey uses, then
 * optional script (`Hans`), region (`BE`, `419`) and variants (`valencia`).
 */
export function isValidLanguageCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  const m =
    /^([a-z]{2,3})(-[a-z]{4})?(-(?:[a-z]{2}|\d{3}))?((?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*)$/i.exec(
      code.trim(),
    );
  if (!m) return false;
  const language = m[1].toLowerCase();
  return language.length === 3
    ? THREE_LETTER_LANGUAGES.has(language)
    : VALID_LANGUAGE_CODES.has(language);
}

/**
 * Validate all language codes in a set and return invalid ones
 * @param languageCodes Array of language codes to validate
 * @returns Array of invalid language codes found
 */
export function validateLanguageCodes(languageCodes: string[]): string[] {
  return languageCodes.filter((code) => !isValidLanguageCode(code));
}

/**
 * The base language from `settings.default_language` (`English (en)`,
 * `fr-BE`), falling back to `en`.
 */
export function getBaseLanguage(settings: Record<string, unknown>): string {
  const defaultLanguage = settings.default_language;
  if (defaultLanguage && typeof defaultLanguage === 'string') {
    return languageTagOf(defaultLanguage) ?? 'en';
  }
  return 'en';
}
