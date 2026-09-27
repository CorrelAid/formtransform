/**
 * XLSForm → DDI-Codebook 2.5.
 *
 * Thin direction wrapper: `variables.ts` turns XLSForm survey/choices rows into
 * the canonical `Variable[]` model, then `ddi/codebook.ts` emits the XML. The
 * same emitter serves the LimeSurvey-TSV inbound path (`pipelines/lstsv2ddi/`).
 */

import type { WarningHandler } from '../../diagnostics.js';
import { languageTagOf } from '../../utils/languageUtils.js';
import { buildDdiCodebook } from '../../ddi/codebook.js';
import { instrumentFromXlsform } from '../../instrument/fromXlsform.js';
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
/** The BCP 47 tag of `settings.default_language` (`German (de)` → `de`). */
function ddiLanguage(
  settings: BuildDdiOptions['settings'],
): string | undefined {
  const raw = settings?.default_language;
  return typeof raw === 'string'
    ? (languageTagOf(raw) ?? undefined)
    : undefined;
}

/**
 * Without `default_language`, a form in several languages has the first as
 * its base: declare it, so the untagged DDI texts say their language (#135).
 */
function multilingualBase(
  surveyRows: Record<string, unknown>[],
): string | undefined {
  const tags = instrumentFromXlsform(surveyRows)
    .languages.map((l) => (l ? languageTagOf(l) : null))
    .filter((t): t is string => !!t);
  return new Set(tags).size > 1 ? tags[0] : undefined;
}

export function buildDdiXml(
  surveyRows: Record<string, unknown>[],
  choices:
    | Record<string, unknown>[]
    | Record<string, Array<{ name?: unknown; label?: unknown }>>,
  {
    onWarning,
    ...options
  }: BuildDdiOptions & { onWarning?: WarningHandler } = {},
): string {
  // settings.default_language picks the label column the DDI text comes from.
  const language = ddiLanguage(options.settings);
  const choicesByList = Array.isArray(choices)
    ? choicesByListFromRows(choices, language)
    : normalizeChoices(choices);
  const variables = extractVariables(surveyRows, choicesByList, {
    language,
    onWarning,
  });
  const base = language ?? multilingualBase(surveyRows);
  return buildDdiCodebook(
    variables,
    base && !language
      ? {
          ...options,
          settings: { ...options.settings, default_language: base },
        }
      : options,
  ).toDocument();
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
