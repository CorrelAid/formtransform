/**
 * `convention:logicMapping` → `selectionCount`: XLSForm's `count-selected()`,
 * the number of ticked answers of a `select_multiple`. In an expression it
 * becomes `count()` over the question's subquestion fields; a constraint that
 * bounds it on the question itself becomes LimeSurvey's `min_answers` /
 * `max_answers` attributes.
 */
import conventions from '../generated/conventions.js';
import { FROM_FILE_BASE } from './fromFile.js';

export const SELECTION_COUNT =
  conventions.conventions.logicMapping.selectionCount;

/** The XPath function name (`count-selected`). */
export const COUNT_SELECTED: string = SELECTION_COUNT.xlsformFunction;

/** LimeSurvey attribute holding the lower bound (`min_answers`). */
export const MIN_ANSWERS_ATTRIBUTE: string =
  SELECTION_COUNT.constraintBounds.minAttribute;

/** LimeSurvey attribute holding the upper bound (`max_answers`). */
export const MAX_ANSWERS_ATTRIBUTE: string =
  SELECTION_COUNT.constraintBounds.maxAttribute;

/**
 * Whether `count-selected()` applies to a question of this base type (a
 * `select_*_from_file` counts as its base select).
 */
export function countsSelections(baseType: string): boolean {
  return (SELECTION_COUNT.appliesTo as readonly string[]).includes(
    FROM_FILE_BASE[baseType] ?? baseType,
  );
}
