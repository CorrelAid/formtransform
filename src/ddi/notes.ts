/**
 * Classify `note` variables so they emit spec-correctly.
 *
 * A `<var>` in `dataDscr` must describe a data column, but notes carry no
 * respondent data. Each note becomes one of:
 *
 * - **inline** — a note followed by a data-carrying variable in the same group
 *   attaches to that variable's `<qstn>` as `<preQTxt>`.
 * - **orphan** — a note with no data-carrying successor in its group (intro /
 *   outro / group-trailing) emits as `<notes type="instruction">` on `<stdyDscr>`.
 *
 * Consecutive inline notes for the same variable join with a blank line.
 */

import { Variable } from './types.js';

export interface ClassifiedNotes {
  /** Data-carrying variables in original order (notes removed). */
  dataVars: Variable[];
  /** `variable.name` → combined preceding-note text (joined with `\n\n`). */
  inlinePreqtxt: Record<string, string>;
  /** Notes with no data-carrying successor in the same group. */
  orphanNotes: Variable[];
}

/** Split notes into inline (`<preQTxt>`) and orphan (`<notes>`) buckets. */
export function classifyNotes(variables: Variable[]): ClassifiedNotes {
  const dataVars: Variable[] = [];
  const inline: Record<string, string[]> = {};
  const orphan: Variable[] = [];
  let pending: Variable[] = [];

  for (const v of variables) {
    if (v.type === 'note') {
      pending.push(v);
      continue;
    }

    // A data-carrying variable resolves pending notes: same-group notes attach
    // to it; different-group notes have no successor in scope → orphan.
    const sameGroup = pending.filter((n) => n.group === v.group && n.label);
    const diffGroup = pending.filter((n) => n.group !== v.group);
    if (sameGroup.length) {
      (inline[v.name] ??= []).push(...sameGroup.map((n) => n.label));
    }
    orphan.push(...diffGroup);
    pending = [];
    dataVars.push(v);
  }

  // Anything left has no successor at all → study outro.
  orphan.push(...pending);

  const inlinePreqtxt: Record<string, string> = {};
  for (const [name, parts] of Object.entries(inline)) {
    inlinePreqtxt[name] = parts.join('\n\n');
  }

  return { dataVars, inlinePreqtxt, orphanNotes: orphan };
}
