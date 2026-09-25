/**
 * Normalize names and answer codes to the characters LimeSurvey accepts, per
 * `convention:sanitization` (`registry/conventions/sanitization.jsonld`):
 * transliterate (`ä→ae`, `ß→ss`), drop remaining diacritics (`é→e`), then
 * delete everything outside `[a-zA-Z0-9]`. Truncation and deduplication are
 * the caller's (FieldSanitizer). Every place that strips a name, including
 * `${ref}` resolution in expressions, must go through here, or references stop
 * matching the names they point at.
 */
import conventions from '../generated/conventions.js';

interface StripRules {
  transliterate: Record<string, string>;
  stripDiacritics: boolean;
  stripCharsRegex: string;
}

function normalizer(rules: StripRules): (s: string) => string {
  const strip = new RegExp(rules.stripCharsRegex, 'g');
  const map = Object.entries(rules.transliterate);
  return (s) => {
    let out = s;
    for (const [from, to] of map) out = out.split(from).join(to);
    if (rules.stripDiacritics) {
      out = out.normalize('NFKD').replace(/\p{M}/gu, '');
    }
    return out.replace(strip, '');
  };
}

const RULES = conventions.conventions.sanitization;

/** A field name reduced to `[a-zA-Z0-9]*`, not yet truncated. */
export const normalizeName = normalizer(RULES.name);

/** An answer code reduced to `[a-zA-Z0-9]*`, not yet truncated. */
export const normalizeCode = normalizer(RULES.choiceCode);
