/**
 * LimeSurvey response rows (keyed and coded as LimeSurvey has them) → the
 * XLSForm's names and answer codes, per a mapping (convention:lstsvMapping).
 */
import type { Submission } from '../../ddi/data.js';
import type { Variable } from '../../ddi/types.js';
import type { LstsvMapping } from '../../conventions/lstsvMapping.js';

/** Variable types whose values are answer codes (space-separated for several). */
function holdsCodes(v: Variable): boolean {
  return v.type.startsWith('select_');
}

/**
 * Rename each submission's keys from `lsVariables` to `variables` (the same
 * survey projected with the mapping: same order) and its answer codes back
 * to the XLSForm's.
 */
export function remapSubmissions(
  submissions: Submission[],
  lsVariables: Variable[],
  variables: Variable[],
  mapping: LstsvMapping,
): Submission[] {
  const pairs = lsVariables.map((ls, i) => ({
    from: ls.name,
    to: variables[i]?.name ?? ls.name,
    codes: holdsCodes(ls)
      ? ((ls.listName ? mapping.codes[ls.listName] : undefined) ??
        mapping.codes[ls.name])
      : undefined,
  }));
  return submissions.map((row) => {
    const out: Submission = {};
    for (const { from, to, codes } of pairs) {
      const value = row[from];
      out[to] =
        codes && typeof value === 'string'
          ? value
              .split(' ')
              .map((c) => codes[c] ?? c)
              .join(' ')
          : value;
    }
    return out;
  });
}
