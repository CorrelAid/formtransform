/**
 * LimeSurvey structure TSV → XLSForm.
 *
 * See `./README.md` for the reverse mappings, the bounded EM dialect the
 * expression reverser inverts, and the full list of known losses. `calculation`
 * is out of scope (the `calculate` type is not registered, so forward never
 * produces one to reverse).
 */

import { parseLstsv } from '../../lstsv/parser.js';
import { validateLstsvSubset } from '../../lstsv/validate.js';
import type { SubsetViolation } from '../../diagnostics.js';

import { lstsvRowsToXlsform } from './toXlsform.js';
import type { XlsformOutput } from './toXlsform.js';

export { lstsvRowsToXlsform } from './toXlsform.js';
export type { XlsformOutput } from './toXlsform.js';

export interface LstsvToXlsformOptions {
  /** Skip the reverse subset check (unsupported question-type codes). */
  skipValidation?: boolean;
}

/**
 * Reconstruct an XLSForm's survey/choices/settings rows from a LimeSurvey
 * structure TSV. Rejects TSVs using question types outside the transformable
 * subset (unless `skipValidation`) — see {@link validateLstsvSubset}.
 */
export function lstsvToXlsform(
  tsv: string,
  options: LstsvToXlsformOptions = {},
): XlsformOutput {
  const rows = parseLstsv(tsv);

  if (!options.skipValidation) {
    const errors: SubsetViolation[] = validateLstsvSubset(rows).filter(
      (v) => v.severity === 'error',
    );
    if (errors.length > 0) {
      throw new Error(
        `LimeSurvey TSV uses ${errors.length} feature(s) outside the transformable subset:\n  - ` +
          errors.map((e) => e.message).join('\n  - '),
      );
    }
  }

  return lstsvRowsToXlsform(rows);
}
