/**
 * XLSForm → DDI-Codebook 2.5.
 *
 * Thin direction wrapper: `variables.ts` turns XLSForm survey/choices rows into
 * the canonical `Variable[]` model, then `ddi/codebook.ts` emits the XML. The
 * same emitter serves the LimeSurvey-TSV inbound path (`pipelines/lstsv2ddi/`).
 */

import { buildDdiCodebook } from '../../ddi/codebook.js';
import type { BuildDdiOptions } from '../../ddi/codebook.js';

import {
  choicesByListFromRows,
  extractVariables,
  normalizeChoices,
} from './variables.js';

/**
 * Build a DDI-Codebook 2.5 XML string from parsed XLSForm data.
 *
 * `choices` may be a flat choices sheet (`ChoiceRow[]`) or an already-grouped
 * `{ list_name: Choice[] }` map.
 */
export function buildDdiXml(
  surveyRows: Record<string, unknown>[],
  choices:
    | Record<string, unknown>[]
    | Record<string, Array<{ name?: unknown; label?: unknown }>>,
  options: BuildDdiOptions = {},
): string {
  const choicesByList = Array.isArray(choices)
    ? choicesByListFromRows(choices)
    : normalizeChoices(choices);
  const variables = extractVariables(surveyRows, choicesByList);
  return buildDdiCodebook(variables, options).toDocument();
}

export {
  buildDataCsv,
  getDdiColumnNames,
  remapSubmissionsToDdi,
} from '../../ddi/data.js';
export type { Submission } from '../../ddi/data.js';

export {
  extractVariables,
  choicesByListFromRows,
  normalizeChoices,
} from './variables.js';
