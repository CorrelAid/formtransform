/**
 * `convention:languageTagging`: XLSForm and DDI carry BCP 47 tags as written;
 * LimeSurvey has its own fixed set of language codes, so a tag is mapped onto
 * one of them (#67).
 */
import conventions from '../generated/conventions.js';

const RULE = conventions.conventions.languageTagging.lsTsvHandling;

const BY_LOWER = new Map(
  RULE.limesurveyLanguages.codes.map((c) => [c.toLowerCase(), c]),
);
const ALIASES = new Map(
  Object.entries(RULE.aliases as Record<string, string>).map(([k, v]) => [
    k.toLowerCase(),
    v,
  ]),
);

/**
 * 3-letter language subtags a tag may start with: those in LimeSurvey's
 * codes (`ceb`, `ckb`, `fil`, …). Any other language needs its 2-letter
 * ISO 639-1 code, as BCP 47 requires the shortest form (`de`, not `deu`).
 */
export const THREE_LETTER_LANGUAGES: ReadonlySet<string> = new Set(
  RULE.limesurveyLanguages.codes
    .map((c) => c.split('-')[0].toLowerCase())
    .filter((c) => c.length === 3),
);

/** How a tag maps onto a LimeSurvey code. */
export interface LimeSurveyLanguage {
  code: string;
  /** True when only the primary language matched (`fr-BE` → `fr`). */
  approximate: boolean;
}

/** The LimeSurvey code for a BCP 47 tag, or `null` if LimeSurvey has none. */
export function toLimeSurveyLanguage(tag: string): LimeSurveyLanguage | null {
  const lower = tag.trim().toLowerCase();
  const exact = BY_LOWER.get(lower) ?? ALIASES.get(lower);
  if (exact) return { code: exact, approximate: false };
  const primary = lower.split('-')[0];
  const code = BY_LOWER.get(primary) ?? ALIASES.get(primary);
  return code ? { code, approximate: true } : null;
}
