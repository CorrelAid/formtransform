/**
 * The sheet columns the model doesn't lift (`convention:ddiFields`
 * `liftedColumns`, #160): kept by name, so a codebook can carry them and an
 * XLSForm get them back.
 */
import { APPEARANCES } from '../generated/Appearances.js';
import conventions from '../generated/conventions.js';
import { isMetadataType } from './metadata.js';

const LIFTED = conventions.conventions.ddiFields.liftedColumns;

/**
 * `group`: a `begin_group` row, which lifts no question-only column (#179).
 * `row`: a note row or a row without data, which lifts only what its
 * `cdl:row_*` notes carry (#195).
 */
export type Sheet = 'survey' | 'group' | 'row' | 'choices';

const QUESTION_ONLY = new Set<string>(LIFTED.questionOnly);

const liftedBy: Record<Sheet, Set<string>> = {
  survey: new Set(LIFTED.survey),
  group: new Set(LIFTED.survey.filter((c) => !QUESTION_ONLY.has(c))),
  row: new Set(LIFTED.row),
  choices: new Set(LIFTED.choices),
};

/**
 * Appearances the registry marks `carriesData: false`: the row renders (a
 * matrix header shows the shared choice labels above the body rows) but
 * stores no response.
 */
const NO_DATA_APPEARANCES: ReadonlySet<string> = new Set(
  Object.entries(APPEARANCES)
    .filter(([, spec]) => spec.carriesData === false)
    .map(([appearance]) => appearance),
);

/** An appearance whose row stores no response (a matrix header's). */
export function carriesNoData(appearance: string): boolean {
  return NO_DATA_APPEARANCES.has(appearance);
}

/**
 * The columns a survey row of `type` (the base type) lifts: a note, a
 * metadata row and a matrix header have no var, so only their `row`
 * fields; any other question every survey column (#195).
 */
export function questionSheet(type: string, appearance: string): Sheet {
  return type === 'note' || isMetadataType(type) || carriesNoData(appearance)
    ? 'row'
    : 'survey';
}

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
