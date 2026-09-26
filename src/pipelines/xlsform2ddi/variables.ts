/**
 * XLSForm rows → the DDI's {@link Variable} list, through the Instrument
 * model (#69), plus the choices-sheet helpers.
 */

import { extractLanguageCode } from '../../utils/languageUtils.js';
import { Choice, Variable } from '../../ddi/types.js';
import { variablesFromInstrument } from '../../ddi/fromInstrument.js';
import { instrumentFromXlsform } from '../../instrument/fromXlsform.js';

type Row = Record<string, unknown>;

// Semi-open "other" convention: the `or_other` type shorthand is expanded
// into an `other` category plus a `<base>_other` text variable here, because
// the DDI emitter only recognizes the explicit pair (`detectOtherPatterns`).

/** Coerce a cell value to a string; objects/arrays/functions become `''`. */
function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/**
 * The label column DDI text comes from: the `label::<tag>` of `language`
 * (settings.default_language) when there is one, else the first
 * `label::…`, else `label`.
 */
function findLabelCol(rows: Row[], language?: string): string {
  const first = rows[0];
  if (!first) return 'label';
  const cols = Object.keys(first).filter((k) => k.startsWith('label::'));
  const own = language
    ? cols.find((k) => extractLanguageCode(k) === language)
    : undefined;
  return own ?? cols[0] ?? 'label';
}

/**
 * Read a label cell, tolerating `{ lang: value }` maps: `language`'s value,
 * else the first.
 */
function readLabel(row: Row, col: string, language?: string): string {
  const raw = row[col] ?? row['label'];
  if (raw != null && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    return toStr((language && map[language]) ?? Object.values(map)[0]);
  }
  return toStr(raw);
}

/** Normalize a raw choices map into `{ list_name: Choice[] }`. */
export function normalizeChoices(
  choicesByList: Record<string, Array<{ name?: unknown; label?: unknown }>>,
): Record<string, Choice[]> {
  const out: Record<string, Choice[]> = {};
  for (const [ln, items] of Object.entries(choicesByList)) {
    out[ln] = items.map((c) => ({
      name: toStr(c.name),
      label: toStr(c.label),
    }));
  }
  return out;
}

/** Build `{ list_name: Choice[] }` from a flat choices sheet. */
export function choicesByListFromRows(
  choiceRows: Row[],
  language?: string,
): Record<string, Choice[]> {
  const labelCol = findLabelCol(choiceRows, language);
  const out: Record<string, Choice[]> = {};
  for (const row of choiceRows) {
    const key = toStr(row['list_name']);
    if (!key) continue;
    (out[key] ??= []).push({
      name: toStr(row['name']),
      label: readLabel(row, labelCol, language),
    });
  }
  return out;
}

/**
 * Extract a flat list of {@link Variable} from parsed survey rows.
 *
 * `choicesByList` maps a list name to its resolved options.
 */
export function extractVariables(
  surveyRows: Row[],
  choicesByList: Record<string, Choice[]>,
  options: { language?: string } = {},
): Variable[] {
  return variablesFromInstrument(
    instrumentFromXlsform(surveyRows),
    choicesByList,
    options,
  );
}
