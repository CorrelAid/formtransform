/**
 * An appearance can select a LimeSurvey question theme (registry Appearance
 * `lsQuestionTheme`): `name` goes to the Q row's `question_theme_name`, each
 * theme attribute to a column of its own. `autocomplete` → `!` +
 * `bootstrap_dropdown` + `show_search=true`, LimeSurvey's searchable dropdown
 * (#226). LimeSurvey's TSV import sets the theme from `question_theme_name`
 * and stores the other columns as question attributes.
 */
import { APPEARANCES } from '../generated/Appearances.js';

type Row = Record<string, string>;

/** The structure-TSV column naming a Q row's LimeSurvey question theme. */
export const QUESTION_THEME_COLUMN = 'question_theme_name';

function cell(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

/** Appearances that select a LimeSurvey question theme (registry `lsQuestionTheme`). */
const THEMED_APPEARANCES = Object.entries(APPEARANCES).filter(
  ([, spec]) => spec.lsQuestionTheme,
);

/** A theme attribute value as LimeSurvey may store a boolean (`true` / `1`). */
function themeValue(value: string): string {
  const v = value.trim().toLowerCase();
  return v === '1' ? 'true' : v;
}

/**
 * The appearance whose question theme and theme attributes this Q row carries
 * (`!` + `bootstrap_dropdown` + `show_search=true` → `autocomplete`), if any.
 */
export function themedAppearanceOf(
  lsCode: string,
  base: string,
  row: Row,
): string | undefined {
  const theme = cell(row, QUESTION_THEME_COLUMN);
  if (!theme) return undefined;
  for (const [name, spec] of THEMED_APPEARANCES) {
    const t = spec.lsQuestionTheme!;
    if (t.name !== theme) continue;
    if (spec.lsTypeOverride && spec.lsTypeOverride !== lsCode) continue;
    if (spec.validForTypes && !spec.validForTypes.includes(base)) continue;
    const attrs = Object.entries(t.attributes ?? {});
    if (attrs.every(([k, v]) => themeValue(cell(row, k)) === themeValue(v))) {
      return name;
    }
  }
  return undefined;
}
