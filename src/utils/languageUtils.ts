/**
 * @file Utility functions for handling multiple language support in XLSForms
 */

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
 * Extract language code from column header (e.g., "label::English (en)" -> "en")
 */
export function extractLanguageCode(header: string): string | null {
  // Pattern: label::Language Name (code) or label::code
  // Handle both "label::English (en)" and "label::Español (es)" formats
  const match = header.match(/::\s*[^)]+\(([a-z]{2})\)/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }

  // Fallback: label::code (without parentheses)
  const simpleMatch = header.match(/::\s*([a-z]{2})\b/i);
  if (simpleMatch && simpleMatch[1]) {
    return simpleMatch[1].toLowerCase();
  }

  return null;
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
 * Validate a language code against IANA language subtag registry
 * @param code Language code to validate (e.g., 'en', 'es')
 * @returns true if valid, false otherwise
 */
export function isValidLanguageCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;

  // Convert to lowercase and trim
  const normalizedCode = code.toLowerCase().trim();

  // Must be exactly 2 characters
  if (normalizedCode.length !== 2) return false;

  // Must contain only letters
  if (!/^[a-z]{2}$/.test(normalizedCode)) return false;

  // Check against known valid language codes
  return VALID_LANGUAGE_CODES.has(normalizedCode);
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
 * Get the base language from settings (fallback to 'en')
 */
export function getBaseLanguage(settings: Record<string, unknown>): string {
  const defaultLanguage = settings.default_language;
  if (defaultLanguage && typeof defaultLanguage === 'string') {
    // Try to extract language code from formats like "Spanish (es)" or "English (en)"
    const match = defaultLanguage.match(/\(([a-z]{2})\)/i);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
    // Fallback to extractLanguageCode for other formats
    return extractLanguageCode(defaultLanguage) || 'en';
  }
  return 'en';
}
