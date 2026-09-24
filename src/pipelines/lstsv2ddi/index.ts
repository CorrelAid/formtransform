/**
 * LimeSurvey structure TSV → DDI-Codebook 2.5 XML.
 *
 * Reads a LimeSurvey TSV back into the canonical {@link Variable} model and
 * feeds the shared DDI emitter (`src/ddi/`). Reverse direction of the
 * XLSForm → LimeSurvey TSV path; see {@link ./toVariables} for the lossy-but-
 * DDI-lossless type collapses.
 */

import { buildDdiCodebook } from '../../ddi/codebook.js';
import type { BuildDdiOptions } from '../../ddi/codebook.js';

import { parseLstsv } from '../../lstsv/parser.js';
import { validateLstsvSubset } from '../../lstsv/validate.js';
import { buildDataCsv } from '../xlsform2ddi/data.js';
import type { Submission } from '../xlsform2ddi/data.js';
import { normalizeLimeSurveyResponses } from './data.js';
import type { NormalizeResponsesOptions } from './data.js';
import { lstsvToVariables } from './toVariables.js';

export { parseLstsv } from '../../lstsv/parser.js';
export { lstsvToVariables } from './toVariables.js';
export { validateLstsvSubset } from '../../lstsv/validate.js';
export { normalizeLimeSurveyResponses } from './data.js';
export type { NormalizeResponsesOptions } from './data.js';

/** Options for {@link lstsvToDdiXml} beyond the DDI build options. */
export interface LstsvToDdiOptions extends BuildDdiOptions {
  /**
   * Skip the reverse subset check (unsupported question-type codes). Off by
   * default: an unsupported code would otherwise silently mis-type a variable.
   */
  skipValidation?: boolean;
}

/** Parse a TSV and apply the reverse subset check unless skipped. */
function parseChecked(
  tsv: string,
  skipValidation: boolean | undefined,
): Record<string, string>[] {
  const rows = parseLstsv(tsv);
  if (skipValidation) return rows;
  const violations = validateLstsvSubset(rows);
  const errors = violations.filter((v) => v.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `LimeSurvey TSV uses ${errors.length} feature(s) outside the transformable subset:\n  - ` +
        errors.map((e) => e.message).join('\n  - '),
    );
  }
  return rows;
}

/**
 * Build a DDI-Codebook 2.5 XML string from a LimeSurvey structure TSV.
 *
 * Rejects TSVs using question types outside the transformable subset (unless
 * `skipValidation`); see {@link validateLstsvSubset}. When no `assetName` is
 * given, the study title falls back to the TSV's `surveyls_title` (SL) row,
 * then `settings.form_title`, then `Untitled`.
 */
export function lstsvToDdiXml(
  tsv: string,
  options: LstsvToDdiOptions = {},
): string {
  const { skipValidation, ...ddiOptions } = options;
  const rows = parseChecked(tsv, skipValidation);

  const title = rows.find(
    (r) => r.class?.trim() === 'SL' && r.name?.trim() === 'surveyls_title',
  )?.text;

  const opts: BuildDdiOptions = { ...ddiOptions };
  if (!opts.assetName && title?.trim()) {
    opts.settings = { form_title: title.trim(), ...opts.settings };
  }

  const variables = lstsvToVariables(rows);
  return buildDdiCodebook(variables, opts).toDocument();
}

/** Options for {@link lstsvToDataCsv}. */
export interface LstsvToDataCsvOptions extends NormalizeResponsesOptions {
  /** Skip the reverse subset check, as for {@link lstsvToDdiXml}. */
  skipValidation?: boolean;
}

/**
 * Build the DDI response-data CSV from a LimeSurvey structure TSV and a
 * LimeSurvey response export (question-code headings). Columns match the
 * `<var name="">` order {@link lstsvToDdiXml} emits for the same TSV; see
 * {@link normalizeLimeSurveyResponses} for how export keys are matched.
 */
export function lstsvToDataCsv(
  tsv: string,
  responses: Submission[],
  options: LstsvToDataCsvOptions = {},
): string {
  const { skipValidation, ...normalizeOptions } = options;
  const variables = lstsvToVariables(parseChecked(tsv, skipValidation));
  return buildDataCsv(
    variables,
    normalizeLimeSurveyResponses(variables, responses, normalizeOptions),
  );
}
