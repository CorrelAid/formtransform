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

/** Columns every structure TSV row needs; without them nothing is read. */
const REQUIRED_COLUMNS = ['class', 'type/scale', 'name', 'text', 'language'];

/** Row classes the reverse pipelines read (survey, groups, questions, options). */
const KNOWN_CLASSES = new Set(['S', 'SL', 'G', 'Q', 'SQ', 'A']);

/**
 * Report what in a LimeSurvey structure TSV is outside the supported subset:
 * a missing required column (error), a row class the reverse ignores
 * (warning, once per class), and a `Q` row whose `type/scale` code is not
 * one the pipeline maps (error).
 */
export function validateLstsvSubset(rows: Row[]): SubsetViolation[] {
  const violations: SubsetViolation[] = [];
  const header = rows[0] ? Object.keys(rows[0]) : [];
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (rows.length > 0 && missing.length > 0) {
    violations.push({
      code: 'column-missing',
      severity: 'error',
      message: `LimeSurvey TSV lacks required column(s): ${missing.join(', ')}`,
    });
  }
  const unknownClasses = new Set<string>();
  for (const row of rows) {
    const cls = (row.class ?? '').trim();
    if (cls && !KNOWN_CLASSES.has(cls) && !unknownClasses.has(cls)) {
      unknownClasses.add(cls);
      violations.push({
        code: 'lstsv-outside-subset',
        severity: 'warning',
        message: `rows of class "${cls}" are not read (known: ${[...KNOWN_CLASSES].join(', ')}) and are ignored`,
      });
    }
    if (cls !== 'Q') continue;
    const code = (row['type/scale'] ?? '').trim();
    if (!code || SUPPORTED_LS_CODES.has(code)) continue;
    const where = row.name?.trim() ? ` (question "${row.name.trim()}")` : '';
    violations.push({
      code: 'lstsv-outside-subset',
      severity: 'error',
      message: `unsupported LimeSurvey question type "${code}"${where} — not in the transformable subset (${[...SUPPORTED_LS_CODES].sort().join(', ')})`,
      ...(row.name?.trim() ? { name: row.name.trim() } : {}),
    });
  }
  return violations;
}
