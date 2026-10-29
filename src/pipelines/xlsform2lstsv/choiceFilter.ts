/**
 * `choice_filter` → LimeSurvey `array_filter` (convention:choiceFilter).
 *
 * `selected(${q}, <column>)` keeps the options whose `<column>` value is
 * ticked in the select_multiple `q`. LimeSurvey's `array_filter = q` shows an
 * option only when `q`'s subquestion with the same code is ticked, so the
 * filter converts when each option's `<column>` value is a distinct answer
 * code of `q`. With `<column>` = `name` the codes already match; with another
 * column the question's LimeSurvey answer codes become those values. Anything
 * else is dropped with a warning: LimeSurvey then shows every option.
 */
import type { QuestionItem } from '../../instrument/types.js';
import type { ChoiceRow } from '../../xlsform/types.js';
import { warning } from '../../diagnostics.js';
import type { WarningHandler } from '../../diagnostics.js';
import {
  CHOICE_FILTER_COLUMN,
  CODE_COLUMN,
  canFilter,
  isFilterable,
  parseChoiceFilter,
} from '../../conventions/choiceFilter.js';
import { FROM_FILE_BASE } from '../../conventions/fromFile.js';

/** What a convertible choice_filter gives the filtered question. */
export interface ArrayFilter {
  /** The filtering question's LimeSurvey name: the `array_filter` value. */
  question: string;
  /** Choice name → answer code, when the codes change (`<column>` ≠ `name`). */
  codes?: Map<string, string>;
}

/** What {@link resolveArrayFilter} needs from the conversion. */
export interface ArrayFilterDeps {
  /** XLSForm name → LimeSurvey name. */
  sanitizeName(name: string): string;
  /** A question's XLSForm base type and list, by LimeSurvey name. */
  baseTypeOf(resolvedName: string): string | undefined;
  /** Choice name → LimeSurvey answer code, by LimeSurvey name. */
  codeMapOf(resolvedName: string): ReadonlyMap<string, string> | undefined;
  /** The question's options. */
  choices: ChoiceRow[];
  /** The filtered question's own base type (`select_one`, …). */
  baseType: string;
  onWarning: WarningHandler;
}

const cellText = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';

/** Each option's code in the filtering question, or why there is none. */
function optionCodes(
  choices: ChoiceRow[],
  column: string,
  filterCodes: ReadonlyMap<string, string>,
  filterName: string,
): Map<string, string> | string {
  const codes = new Map<string, string>();
  const used = new Set<string>();
  for (const choice of choices) {
    const name = cellText(choice.name);
    const value = cellText(choice[column]);
    const code = filterCodes.get(value);
    if (!code) {
      return value
        ? `option "${name}" has ${column} "${value}", which is no answer of "${filterName}"`
        : `option "${name}" has no ${column} value`;
    }
    if (used.has(code)) {
      return `two options share ${column} "${value}"; LimeSurvey needs distinct codes`;
    }
    used.add(code);
    codes.set(name, code);
  }
  return codes;
}

/**
 * The `array_filter` for a question's `choice_filter`, or `null` when it has
 * none or it can't be converted (then with a `choice-filter-dropped` warning).
 */
export function resolveArrayFilter(
  q: QuestionItem,
  deps: ArrayFilterDeps,
): ArrayFilter | null {
  const cell = cellText(q.row[CHOICE_FILTER_COLUMN]);
  if (!cell) return null;
  const drop = (why: string): null => {
    deps.onWarning(
      warning(
        'choice-filter-dropped',
        `${CHOICE_FILTER_COLUMN} "${cell}" on "${q.name}" can't be converted and is dropped (LimeSurvey shows every option): ${why}`,
        q.name,
      ),
    );
    return null;
  };

  const base = FROM_FILE_BASE[deps.baseType] ?? deps.baseType;
  if (!isFilterable(base)) return drop(`a ${base} has no options to filter`);
  const parsed = parseChoiceFilter(cell);
  if (!parsed) {
    return drop(
      `only "selected(\${question}, column)" on an earlier select_multiple converts`,
    );
  }
  const filter = deps.sanitizeName(parsed.question);
  const filterBase = deps.baseTypeOf(filter) ?? '';
  const filterCodes = deps.codeMapOf(filter);
  if (!canFilter(FROM_FILE_BASE[filterBase] ?? filterBase) || !filterCodes) {
    return drop(`"${parsed.question}" is no select_multiple`);
  }

  const codes = optionCodes(
    deps.choices,
    parsed.column,
    filterCodes,
    parsed.question,
  );
  if (typeof codes === 'string') return drop(codes);
  const own = deps.codeMapOf(deps.sanitizeName(q.name));
  if ([...codes].every(([name, code]) => own?.get(name) === code)) {
    return { question: filter };
  }
  deps.onWarning(
    warning(
      'choice-filter-recoded',
      `"${q.name}" takes its LimeSurvey answer codes from the ${parsed.column === CODE_COLUMN ? 'codes' : `"${parsed.column}" column`} of "${parsed.question}" for its ${CHOICE_FILTER_COLUMN}: LimeSurvey stores those codes for it, not the list's names`,
      q.name,
    ),
  );
  return { question: filter, codes };
}
