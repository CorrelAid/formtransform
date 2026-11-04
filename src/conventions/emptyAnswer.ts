/**
 * `convention:logicMapping` → `emptyAnswer`: ODK evaluates a constraint only
 * on an answered question, LimeSurvey evaluates `em_validation_q` on an empty
 * one too. A question that is not required gets its validation equation
 * guarded, `is_empty(self) or (<equation>)`, so it can still be left empty.
 */
import conventions from '../generated/conventions.js';

export const EMPTY_ANSWER = conventions.conventions.logicMapping.emptyAnswer;

/** The EM test for "not answered" (`is_empty(self)`). */
export const EMPTY_GUARD: string = EMPTY_ANSWER.guard;

/**
 * The XPath for "not answered" on a select_multiple, whose `self` stands for
 * all its subquestions (`count-selected(.) = 0`); transpiled like any
 * constraint term.
 */
export const SELECT_MULTIPLE_EMPTY_GUARD: string =
  EMPTY_ANSWER.selectMultipleGuard;

/** `<guard> or (<equation>)`; an empty equation stays empty. */
export function guardEmpty(equation: string, guard: string): string {
  return equation ? `${guard} or (${equation})` : '';
}
