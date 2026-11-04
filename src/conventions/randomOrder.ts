/**
 * `convention:randomOrder`: XLSForm `parameters: randomize=true` on a select
 * shuffles its options. LimeSurvey 6 orders them by a question attribute that
 * depends on the question type: `answer_order=random` on a list or dropdown,
 * `subquestion_order=random` on a multiple choice. A randomized multiple
 * choice's exclusive answers keep their position (`keep_codes_order`), and
 * so do the choices marked `fixed` (any select).
 */
import conventions from '../generated/conventions.js';
import { parseParameters } from '../utils/parameters.js';
import type { ChoiceRow } from '../xlsform/types.js';
import { FROM_FILE_BASE } from './fromFile.js';

export const RANDOM_ORDER_RULE = conventions.conventions.randomOrder;

/** LimeSurvey type code → the attribute and value that shuffle its options. */
export const RANDOM_ORDER_ATTRIBUTES: Readonly<
  Record<string, { attribute: string; value: string }>
> = RANDOM_ORDER_RULE.limesurveyAttributes;

/** The attribute that keeps codes in place while LimeSurvey shuffles. */
export const KEEP_CODES_ATTRIBUTE: string = RANDOM_ORDER_RULE.keepAttribute;

const TRUE_VALUES = new Set<string>(RANDOM_ORDER_RULE.trueValues);

/** The `parameters` entry for random order (`randomize=true`). */
export const RANDOMIZE_PARAMETER = `${RANDOM_ORDER_RULE.parametersKey}=${RANDOM_ORDER_RULE.trueValues[0]}`;

/** Whether a question of this base type can be randomized. */
export function randomizable(baseType: string): boolean {
  return (RANDOM_ORDER_RULE.appliesTo as readonly string[]).includes(
    FROM_FILE_BASE[baseType] ?? baseType,
  );
}

/** A `parameters` cell's random-order request: whether, and its seed if any. */
export function randomizeOf(cell: unknown): {
  randomize: boolean;
  seed?: string;
} {
  const values = parseParameters(cell);
  const flag = values[RANDOM_ORDER_RULE.parametersKey];
  const randomize = flag !== undefined && TRUE_VALUES.has(flag.toLowerCase());
  const seed = values[RANDOM_ORDER_RULE.seedKey];
  return { randomize, ...(seed !== undefined ? { seed } : {}) };
}

/**
 * Whether a LimeSurvey Q row of type `lsCode` shuffles its options: its
 * type's ordering attribute, or the legacy `random_order=1`.
 */
export function isRandomOrder(
  lsCode: string,
  cell: (attribute: string) => string,
): boolean {
  const spec = RANDOM_ORDER_ATTRIBUTES[lsCode];
  if (!spec) return false;
  const legacy = RANDOM_ORDER_RULE.limesurveyLegacyAttribute;
  return (
    cell(spec.attribute) === spec.value ||
    cell(legacy.attribute) === legacy.value
  );
}

const FIXED_TRUE_VALUES = new Set<string>(RANDOM_ORDER_RULE.fixedTrueValues);

/** Whether the choice is marked `fixed`: it keeps its position when shuffled. */
export function isFixed(choice: ChoiceRow): boolean {
  const value = choice[RANDOM_ORDER_RULE.fixedColumn];
  const text =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
      ? String(value).trim().toLowerCase()
      : '';
  return FIXED_TRUE_VALUES.has(text);
}
