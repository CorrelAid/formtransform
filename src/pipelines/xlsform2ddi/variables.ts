/**
 * XLSForm rows → the DDI's {@link Variable} list, through the Instrument
 * model (#69), plus the choices-sheet helpers.
 */

import type { WarningHandler } from '../../diagnostics.js';
import { Choice, Variable } from '../../ddi/types.js';
import {
  choicesFromInstrument,
  variablesFromInstrument,
} from '../../ddi/fromInstrument.js';
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

/**
 * Build `{ list_name: Choice[] }` from a flat choices sheet: labels in
 * `language` (settings.default_language) when the sheet has it, else its
 * first language, with the other languages as `translations`.
 */
export function choicesByListFromRows(
  choiceRows: Row[],
  language?: string,
): Record<string, Choice[]> {
  return choicesFromInstrument(instrumentFromXlsform([], choiceRows), language);
}

/**
 * Extract a flat list of {@link Variable} from parsed survey rows.
 *
 * `choicesByList` maps a list name to its resolved options.
 */
export function extractVariables(
  surveyRows: Row[],
  choicesByList: Record<string, Choice[]>,
  options: { language?: string; onWarning?: WarningHandler } = {},
): Variable[] {
  return variablesFromInstrument(
    instrumentFromXlsform(surveyRows),
    choicesByList,
    options,
  );
}
