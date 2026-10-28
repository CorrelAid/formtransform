/**
 * The `grid` composite: a `begin_group` whose appearance marks it as a grid
 * and whose rows share one response: one choice list (LimeSurvey: array `F`)
 * or numbers (a table of numbers, #174; LimeSurvey: a plain group). DDI:
 * `<varGrp type="grid">` either way.
 */
import conventions from '../generated/conventions.js';
import { RESPONSE_DOMAIN_MAP } from '../generated/DdiMappings.js';
import { ConversionError } from '../diagnostics.js';

const GRID = conventions.composites.find((c) => c.id === 'grid');
if (!GRID)
  throw new ConversionError(
    'registry-invalid',
    'registry has no grid composite',
  );

/** The `begin_group` appearance that makes a group a grid. */
export const GRID_APPEARANCE: string = GRID.trigger.appearance;

/** Whether a group appearance (possibly several, space-separated) marks a grid. */
export function isGridAppearance(appearance: string): boolean {
  return appearance.split(/\s+/).includes(GRID_APPEARANCE);
}

/** The row types a grid is made of: the composite's broader question types. */
const ROW_TYPES: Set<string> = new Set(
  GRID.broader
    .map((b) => b['@id'].replace(/^type:/, ''))
    .filter((t) => t in RESPONSE_DOMAIN_MAP),
);

/** The response domain of a choice grid's rows (LimeSurvey's array `F`). */
export const CHOICE_GRID_DOMAIN: string = RESPONSE_DOMAIN_MAP['select_one'];

/**
 * The response domain a grid's rows share, by the rows' types: `category`
 * (one choice list) or `numeric` (a table of numbers). `null` when they
 * aren't a grid's: no rows, a type no grid has, or two domains.
 */
export function gridDomain(rowTypes: string[]): string | null {
  if (!rowTypes.length || !rowTypes.every((t) => ROW_TYPES.has(t))) {
    return null;
  }
  const domains = new Set(rowTypes.map((t) => RESPONSE_DOMAIN_MAP[t]));
  return domains.size === 1 ? [...domains][0] : null;
}
