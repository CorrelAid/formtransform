/**
 * The sheet columns the model doesn't lift (`convention:ddiFields`
 * `liftedColumns`, #160): kept by name, so a codebook can carry them and an
 * XLSForm get them back.
 */
import conventions from '../generated/conventions.js';

const LIFTED = conventions.conventions.ddiFields.liftedColumns;

type Sheet = 'survey' | 'choices';

const liftedBy: Record<Sheet, Set<string>> = {
  survey: new Set(LIFTED.survey),
  choices: new Set(LIFTED.choices),
};

function cellText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/**
 * A row's columns the model doesn't lift, non-empty, by column name. A
 * `{ lang: text }` cell is one column per language (`media::image::de`). A
 * column starting with `_` is the loader's, not the form's.
 */
export function otherColumns(
  row: Record<string, unknown>,
  sheet: Sheet | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('_')) continue;
    if (sheet && liftedBy[sheet].has(key.split('::')[0])) continue;
    const cells: Array<[string, unknown]> =
      value !== null && typeof value === 'object'
        ? Object.entries(value).map(([lang, v]) => [`${key}::${lang}`, v])
        : [[key, value]];
    for (const [column, cell] of cells) {
      const text = cellText(cell);
      if (text) out[column] = text;
    }
  }
  return out;
}

/**
 * A row's every cell but the loader's, by column name, `{ lang: text }`
 * cells one per language: a settings row, an `end_group` row.
 */
export function allColumns(
  row: Record<string, unknown>,
): Record<string, string> {
  return otherColumns(row, null);
}
