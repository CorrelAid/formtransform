/**
 * `convention:other`: the semi-open "Other" answer. XLSForm writes it as a
 * choice with code `other` plus a `<question>_other` text companion;
 * LimeSurvey as `other=Y`; DDI as `<varGrp type="other">`.
 */
import conventions from '../generated/conventions.js';

const RULE = conventions.conventions.other;

/** Choice code of the "other" answer. */
export const OTHER_CODE: string = RULE.choiceCode;

/** Suffix of the free-text companion question (`<question>_other`). */
export const OTHER_SUFFIX: string = RULE.companionSuffix;

/** Type of the free-text companion question. */
export const OTHER_COMPANION_TYPE: string = RULE.companionType;

/** Select types that can carry an "other" answer. */
export const OTHER_APPLIES_TO: readonly string[] = RULE.appliesTo;

/** Canonical "other" label per language. */
export const OTHER_LABELS: Readonly<Record<string, string>> = RULE.labels;

/** Canonical "other" label for a language, falling back to English. */
export function otherLabelFor(lang: string): string {
  return OTHER_LABELS[lang] ?? OTHER_LABELS['en'];
}

/** The base question name of an `<base>_other` companion, or `null`. */
export function otherCompanionBase(name: string): string | null {
  return name.endsWith(OTHER_SUFFIX) && name.length > OTHER_SUFFIX.length
    ? name.slice(0, -OTHER_SUFFIX.length)
    : null;
}
