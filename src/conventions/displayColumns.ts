/**
 * ODK `columns-n` (and plain `columns`) on a select question: the options in
 * n columns, LimeSurvey's `display_columns` question attribute (type L or M;
 * its renderer adds the class `nbcol-n`). The count is part of the appearance
 * name, so this is a pattern, not a registry allowlist entry. Plain `columns`
 * lets ODK fit as many columns as the screen takes, which LimeSurvey cannot,
 * so it becomes {@link DEFAULT_COLUMNS}. `display_columns=n` reads back as
 * `columns-n`.
 */

/** The LimeSurvey question attribute holding the column count. */
export const DISPLAY_COLUMNS_ATTRIBUTE = 'display_columns';

/** Column count for plain `columns`. */
export const DEFAULT_COLUMNS = 2;

/** Largest count LimeSurvey's column selector offers. */
export const MAX_COLUMNS = 8;

/** Base types (after from_file folding) and LS codes the attribute applies to. */
export const COLUMNS_BASE_TYPES = [
  'select_one',
  'select_multiple',
  'select_one_from_file',
  'select_multiple_from_file',
];
export const COLUMNS_LS_TYPES = ['L', 'M'];

/** Whether an appearance token is `columns` or `columns-<digits>`. */
export function isColumnsAppearance(token: string): boolean {
  return /^columns(-\d+)?$/.test(token);
}

/** The column count of a `columns*` token; undefined when out of 1..8. */
export function columnsOf(token: string): number | undefined {
  const m = /^columns(?:-(\d+))?$/.exec(token);
  if (!m) return undefined;
  const n = m[1] === undefined ? DEFAULT_COLUMNS : Number(m[1]);
  return n >= 1 && n <= MAX_COLUMNS ? n : undefined;
}

/** The appearance for a `display_columns` cell (`3` → `columns-3`), if valid. */
export function columnsAppearanceOf(cell: string): string | undefined {
  const t = cell.trim();
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= MAX_COLUMNS ? `columns-${n}` : undefined;
}

/** The count of the last valid `columns*` token in an appearance string. */
export function columnsInAppearance(appearance: string): number | undefined {
  let n: number | undefined;
  for (const part of appearance.split(/\s+/)) {
    const c = columnsOf(part);
    if (c !== undefined) n = c;
  }
  return n;
}
