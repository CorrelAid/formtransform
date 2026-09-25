/**
 * The `grid` composite: a `begin_group` whose appearance marks it as a grid
 * (one shared choice list, one row per question). LimeSurvey: array `F`;
 * DDI: `<varGrp type="grid">`.
 */
import conventions from '../generated/conventions.js';

const GRID = conventions.composites.find((c) => c.id === 'grid');
if (!GRID) throw new Error('registry has no grid composite');

/** The `begin_group` appearance that makes a group a grid. */
export const GRID_APPEARANCE: string = GRID.trigger.appearance;

/** Whether a group appearance (possibly several, space-separated) marks a grid. */
export function isGridAppearance(appearance: string): boolean {
  return appearance.split(/\s+/).includes(GRID_APPEARANCE);
}
