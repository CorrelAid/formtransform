/**
 * ISO 639-1 code → English exonym, for reconstructing an XLSForm
 * `settings.default_language` value (e.g. `"German (de)"`) from a LimeSurvey
 * TSV, which only carries the bare code (`de`).
 *
 * `getBaseLanguage` (src/utils/languageUtils.ts) only reads the parenthesized
 * (or bare) tag, so any name works functionally — this table exists so the common
 * cases reproduce the exact string an author would write, not just a
 * functionally-equivalent one. Unlisted codes fall back to `(<code>)`, which
 * `getBaseLanguage` still parses correctly.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  cs: 'Czech',
  ru: 'Russian',
  tr: 'Turkish',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  uk: 'Ukrainian',
};

/**
 * Format a base-language code as an XLSForm `default_language` value. Known
 * codes get their English name (`"German (de)"`); unknown codes fall back to
 * a bare parenthesized form (`"(xx)"`) that still resolves correctly.
 */
export function formatDefaultLanguage(code: string): string {
  const name = LANGUAGE_NAMES[code.toLowerCase()];
  return name ? `${name} (${code})` : `(${code})`;
}
