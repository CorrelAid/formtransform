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
 * Consecutive inline notes for the same variable join with a blank line;
 * their names are kept in order (`cdl:note_names`, #160).
 *
 * Rows without data (metadata rows like `start`, matrix headers: `row` set)
 * carry none either. They and the orphan notes keep their place as a
 * {@link Position} (`cdl:position`).
 */

import { joinTranslations, textsOf } from './translations.js';
import { DdiGroup, Translations, Variable } from './types.js';

export interface ClassifiedNotes {
  /** Data-carrying variables in original order (notes removed). */
  dataVars: Variable[];
  /** `variable.name` → combined preceding-note text (joined with `\n\n`). */
  inlinePreqtxt: Record<string, string>;
  /** The same text in the form's other languages (#135). */
  inlinePreqtxtTranslations: Record<string, Translations>;
  /** `variable.name` → the names of the notes in its `inlinePreqtxt`. */
  inlineNames: Record<string, string[]>;
  /** Notes with no data-carrying successor in the same group. */
  orphanNotes: Variable[];
  /** Rows without data: metadata rows, matrix headers. */
  rows: Variable[];
  /**
   * Where each orphan note, metadata row and group without data is, in
   * survey order (a group by its path, before what it holds).
   */
  positions: Position[];
  /** Groups with no data question under them, each with its enclosing ones. */
  emptyGroups: DdiGroup[][];
}

/** An item's place: its group's path and the item before it there. */
export interface Position {
  name: string;
  /** The enclosing group's path, `''` at the top. */
  in: string;
  /** The name of the item before it in that group, `''` when first. */
  after: string;
  /** A group without data, `name` its path. */
  group?: boolean;
}

/**
 * The place of `variables[index]`: the last item before it in its group, a
 * nested group by its own name. An added `or_other` companion is not an item.
 */
function positionOf(
  variables: Variable[],
  index: number,
  group = variables[index].group,
  name = variables[index].name,
): Position {
  const prefix = group ? `${group}/` : '';
  for (let i = index - 1; i >= 0; i--) {
    const v = variables[i];
    if (v.synthesized) continue;
    if (v.group === group) return { name, in: group, after: v.name };
    if (!v.group.startsWith(prefix)) break;
    const after = v.group.slice(prefix.length).split('/')[0];
    return { name, in: group, after };
  }
  return { name, in: group, after: '' };
}

/** Split notes into inline (`<preQTxt>`) and orphan (`<notes>`) buckets. */
export function classifyNotes(variables: Variable[]): ClassifiedNotes {
  const dataVars: Variable[] = [];
  const inline: Record<string, Variable[]> = {};
  /** Orphan notes and rows without data, by index in `variables`. */
  const placed: number[] = [];
  let pending: number[] = [];

  variables.forEach((v, i) => {
    if (v.row !== undefined) {
      placed.push(i);
      return;
    }
    if (v.type === 'note') {
      pending.push(i);
      return;
    }
    // A data-carrying variable resolves pending notes: same-group notes attach
    // to it; different-group notes have no successor in scope → orphan.
    for (const n of pending) {
      const note = variables[n];
      if (note.group !== v.group) placed.push(n);
      else if (note.label) (inline[v.name] ??= []).push(note);
    }
    pending = [];
    dataVars.push(v);
  });
  // Anything left has no successor at all → study outro.
  placed.push(...pending);
  placed.sort((a, b) => a - b);

  const inlinePreqtxt: Record<string, string> = {};
  const inlinePreqtxtTranslations: Record<string, Translations> = {};
  const inlineNames: Record<string, string[]> = {};
  for (const [name, notes] of Object.entries(inline)) {
    inlinePreqtxt[name] = notes.map((n) => n.label).join('\n\n');
    inlinePreqtxtTranslations[name] = joinTranslations(
      notes.map((n) => textsOf(n, 'label')),
      '\n\n',
    );
    inlineNames[name] = notes.map((n) => n.name);
  }

  const kept = placed.map((i) => variables[i]);
  const { positions, emptyGroups } = placements(variables, dataVars, placed);
  return {
    dataVars,
    inlinePreqtxt,
    inlinePreqtxtTranslations,
    inlineNames,
    orphanNotes: kept.filter((v) => v.type === 'note'),
    rows: kept.filter((v) => v.row !== undefined),
    positions,
    emptyGroups,
  };
}

/**
 * The positions of the placed rows, each preceded by those of its groups
 * that hold no data question: those groups have no other place.
 */
function placements(
  variables: Variable[],
  dataVars: Variable[],
  placed: number[],
): Pick<ClassifiedNotes, 'positions' | 'emptyGroups'> {
  const withData = new Set<string>();
  for (const v of dataVars) {
    for (const g of v.groups ?? []) withData.add(g.path);
  }
  const positions: Position[] = [];
  const emptyGroups: DdiGroup[][] = [];
  for (const i of placed) {
    const chain = variables[i].groups ?? [];
    chain.forEach((g, depth) => {
      if (withData.has(g.path)) return;
      withData.add(g.path);
      const parent = depth ? chain[depth - 1].path : '';
      positions.push({
        ...positionOf(variables, i, parent, g.path),
        group: true,
      });
      emptyGroups.push(chain.slice(0, depth + 1));
    });
    positions.push(positionOf(variables, i));
  }
  return { positions, emptyGroups };
}
