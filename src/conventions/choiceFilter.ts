/**
 * `convention:choiceFilter`: a `choice_filter` that keeps the options ticked
 * in an earlier `select_multiple`, `selected(${q}, <column>)`. LimeSurvey
 * does the same with the `array_filter` question attribute when the option
 * codes equal `q`'s subquestion codes.
 */
import conventions from '../generated/conventions.js';

export const CHOICE_FILTER_RULE = conventions.conventions.choiceFilter;

/** The survey sheet's column (`choice_filter`). */
export const CHOICE_FILTER_COLUMN: string = CHOICE_FILTER_RULE.surveyColumn;

/** The LimeSurvey question attribute (`array_filter`). */
export const ARRAY_FILTER_ATTRIBUTE: string =
  CHOICE_FILTER_RULE.limesurveyAttribute;

/** The choices column holding an option's own code (`name`). */
export const CODE_COLUMN: string = CHOICE_FILTER_RULE.codeColumn;

const FN = CHOICE_FILTER_RULE.selectedFunction;
const PATTERN = new RegExp(
  `^\\s*${FN}\\(\\s*\\$\\{\\s*([^}\\s]+)\\s*\\}\\s*,\\s*([A-Za-z_][A-Za-z0-9_.:-]*)\\s*\\)\\s*$`,
);

/**
 * `selected(${q}, column)` → the filtering question and the choices column,
 * or `null` for any other filter.
 */
export function parseChoiceFilter(
  cell: unknown,
): { question: string; column: string } | null {
  if (typeof cell !== 'string') return null;
  const m = PATTERN.exec(cell);
  return m ? { question: m[1], column: m[2] } : null;
}

/** The choice_filter a LimeSurvey `array_filter = q` means. */
export function choiceFilterFor(question: string): string {
  return `${FN}(\${${question}}, ${CODE_COLUMN})`;
}

/** Whether a question of this base type can be filtered. */
export function isFilterable(baseType: string): boolean {
  return (CHOICE_FILTER_RULE.appliesTo as readonly string[]).includes(baseType);
}

/** Whether a question of this base type can filter another one. */
export function canFilter(baseType: string): boolean {
  return (CHOICE_FILTER_RULE.filterTypes as readonly string[]).includes(
    baseType,
  );
}

/**
 * The choices columns the survey's choice filters read (other than the
 * option's own code), so the loader doesn't call them unexpected.
 */
export function filterColumns(
  surveyRows: readonly Record<string, unknown>[],
): Set<string> {
  const out = new Set<string>();
  for (const row of surveyRows) {
    const parsed = parseChoiceFilter(row[CHOICE_FILTER_COLUMN]);
    if (parsed && parsed.column !== CODE_COLUMN) out.add(parsed.column);
  }
  return out;
}
