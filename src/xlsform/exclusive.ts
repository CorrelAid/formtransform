/**
 * `convention:exclusiveChoice`: a choice marked in the choices sheet's
 * `exclusive` column excludes every other answer of a `select_multiple`
 * ("Keine Angabe", "Nichts davon"). LimeSurvey enforces it through the
 * `exclude_all_others` question attribute.
 */
import conventions from '../generated/conventions.js';
import type { ChoiceRow } from '../config/types.js';

export const EXCLUSIVE_RULE = conventions.conventions.exclusiveChoice;

const TRUE_VALUES = new Set<string>(EXCLUSIVE_RULE.trueValues);

/** The raw `exclusive` cell, trimmed and lower-cased ('' when absent). */
export function exclusiveCell(choice: ChoiceRow): string {
  const value = choice[EXCLUSIVE_RULE.choicesColumn];
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase();
  }
  return '';
}

/** Whether the choice is marked exclusive. */
export function isExclusive(choice: ChoiceRow): boolean {
  return TRUE_VALUES.has(exclusiveCell(choice));
}
