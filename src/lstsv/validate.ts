/**
 * Reverse-path subset validation for LimeSurvey structure TSV → DDI.
 *
 * The forward path validates the XLSForm subset; this is its mirror. It guards
 * the one thing that can silently corrupt a DDI: an unsupported LimeSurvey
 * question-type code. `toVariables` maps a known set of codes and would
 * otherwise fall back unknown codes to `text`, mis-typing the variable.
 *
 * DDI consumes only name/type/label/choices/vocab, so LimeSurvey features the
 * DDI ignores (relevance, validation, conditions, attributes) are intentionally
 * NOT validated here — dropping them is correct for this target.
 */

import { APPEARANCES } from '../generated/Appearances.js';
import { TYPE_MAPPINGS } from '../generated/TypeMappings.js';
import type { SubsetViolation } from '../diagnostics.js';

// Supported LimeSurvey question-type codes: every code the registry maps a type
// to, plus every appearance's `lsTypeOverride` (`T` for `multiline`, `!` for
// `minimal`, …) and the one code the converter emits with no registry mapping
// at all —
//   F: array (table-list grid / matrix header)
// The overrides come from the registry, not a literal list: hardcoding them is
// what let `!` fall outside the subset while the forward path happily emitted it.
const SUPPORTED_LS_CODES = new Set<string>([
  ...Object.values(TYPE_MAPPINGS)
    .map((m) => m.limeSurveyType)
    .filter((c): c is string => c != null),
  ...Object.values(APPEARANCES)
    .map((a) => a.lsTypeOverride)
    .filter((c): c is string => c != null),
  'F',
]);

type Row = Record<string, string>;

/**
 * Report every LimeSurvey structure-TSV row outside the supported subset.
 * Currently: `Q` rows whose `type/scale` code is not one the pipeline maps.
 */
export function validateLstsvSubset(rows: Row[]): SubsetViolation[] {
  const violations: SubsetViolation[] = [];
  for (const row of rows) {
    if ((row.class ?? '').trim() !== 'Q') continue;
    const code = (row['type/scale'] ?? '').trim();
    if (!code || SUPPORTED_LS_CODES.has(code)) continue;
    const where = row.name?.trim() ? ` (question "${row.name.trim()}")` : '';
    violations.push({
      severity: 'error',
      message: `unsupported LimeSurvey question type "${code}"${where} — not in the transformable subset (${[...SUPPORTED_LS_CODES].sort().join(', ')})`,
    });
  }
  return violations;
}
