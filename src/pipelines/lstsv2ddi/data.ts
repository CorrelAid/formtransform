/**
 * LimeSurvey response export → submissions keyed by DDI variable name.
 *
 * `buildDataCsv` (`ddi/data.ts`) reads rows keyed by bare question name
 * or `group/name`. A LimeSurvey response export (question-code headings, as the
 * RemoteControl `export_responses` call and the admin CSV export produce) is
 * keyed differently, so this adapter re-keys each row onto the variables
 * {@link lstsvToVariables} derives from the same survey's structure TSV:
 *
 * - **Underscore/case quirk.** Exports strip underscores and may change case
 *   (`beruf_post` → `berufpost`), so every key is matched on {@link normKey}.
 * - **`select_multiple`** is one column per option, `q[code]`, holding `Y` when
 *   ticked. Codes may be truncated to 5 characters, so they are matched back to
 *   the parsed choice codes by prefix; see {@link matchChoice}.
 * - **Arrays (`F`)** are one column per subquestion, `array[sq]`, holding the
 *   answer code. Each becomes the grid variable named after the subquestion.
 * - **Native "other"** (`other=Y`): a list stores `-oth-` and a multiple choice
 *   question ticks nothing; the free text sits in `q[other]` (or `qother`). It
 *   maps onto the `other` category and the `<base>_other` companion.
 *
 * Kept apart from the shared emitter on purpose: these are LimeSurvey quirks,
 * and the Kobo path must not start guessing at them.
 */

import type { Variable } from '../../ddi/types.js';
import type { Submission } from '../../ddi/data.js';

import { OTHER_CODE, OTHER_SUFFIX } from '../../conventions/other.js';

/** LimeSurvey's stored value for the "other" option of a list question. */
const LS_OTHER_VALUE = '-oth-';
/** Bracket subkey of the free-text "other" column. */
const LS_OTHER_SUBKEY = 'other';
/** Values a ticked multiple-choice option carries across export formats. */
const TICKED = new Set(['y', 'yes', '1', 'true']);

/** Options for {@link normalizeLimeSurveyResponses}. */
export interface NormalizeResponsesOptions {
  /**
   * Called for a `select_multiple` option column whose code matches no parsed
   * choice. That tick has no DDI column and is dropped, so callers should
   * surface this. Defaults to ignoring it.
   */
  onWarning?: (message: string) => void;
}

/** Strip underscores and lowercase, mirroring LimeSurvey's export mangling. */
export function normKey(name: string): string {
  return name.replace(/_/g, '').toLowerCase();
}

/** One response row split into plain columns and `base[sub]` columns. */
interface SplitRow {
  simple: Map<string, unknown>;
  bracketed: Map<string, Map<string, unknown>>;
}

function splitRow(row: Submission): SplitRow {
  const simple = new Map<string, unknown>();
  const bracketed = new Map<string, Map<string, unknown>>();
  for (const [key, value] of Object.entries(row)) {
    const m = /^([^[]+)\[(.*)\]$/.exec(key);
    if (!m) {
      simple.set(normKey(key), value);
      continue;
    }
    const base = normKey(m[1]);
    let subs = bracketed.get(base);
    if (!subs) bracketed.set(base, (subs = new Map<string, unknown>()));
    subs.set(m[2], value);
  }
  return { simple, bracketed };
}

function text(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/**
 * Map a bracket subkey back to a parsed choice code.
 *
 * Exact match first. LimeSurvey may truncate codes to 5 characters, so a single
 * prefix match (either direction) is accepted too. Several prefix matches would
 * silently credit the wrong option, so that throws. No match returns `null`.
 */
function matchChoice(subkey: string, variable: Variable): string | null {
  const codes = variable.choices.map((c) => c.name);
  if (codes.includes(subkey)) return subkey;
  const prefixed = codes.filter(
    (c) => c.startsWith(subkey) || subkey.startsWith(c),
  );
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) {
    throw new Error(
      `ambiguous LimeSurvey option column ${variable.name}[${subkey}]: matches ` +
        `choice codes ${prefixed.join(', ')}. Codes must be unique in their ` +
        'first 5 characters for a LimeSurvey export to be unambiguous.',
    );
  }
  return null;
}

/** Space-joined ticked choice codes of a `select_multiple`. */
function multiValue(
  variable: Variable,
  subs: Map<string, unknown> | undefined,
  warn: (message: string) => void,
): string {
  if (!subs) return '';
  const hasOther = variable.choices.some((c) => c.name === OTHER_CODE);
  const selected: string[] = [];
  for (const [subkey, raw] of subs) {
    if (subkey === LS_OTHER_SUBKEY && hasOther) {
      // The "other" column carries the free text, not a tick.
      if (text(raw).trim() !== '') selected.push(OTHER_CODE);
      continue;
    }
    if (!TICKED.has(text(raw).trim().toLowerCase())) continue;
    const code = matchChoice(subkey, variable);
    if (code === null) {
      warn(
        `LimeSurvey option column ${variable.name}[${subkey}] matches no ` +
          'choice code in the structure TSV; its ticks are dropped',
      );
      continue;
    }
    if (!selected.includes(code)) selected.push(code);
  }
  return selected.join(' ');
}

/** A bracket subkey's value, matched exactly, then on {@link normKey}. */
function subValue(
  subs: Map<string, unknown> | undefined,
  name: string,
): unknown {
  if (!subs) return undefined;
  if (subs.has(name)) return subs.get(name);
  const want = normKey(name);
  for (const [k, v] of subs) if (normKey(k) === want) return v;
  return undefined;
}

/** Array names: `lstsvToVariables` groups an `F` array's rows under its name. */
function isArrayMember(v: Variable): boolean {
  return v.type === 'select_one' && v.group !== '' && v.group === v.listName;
}

/**
 * Re-key LimeSurvey response rows onto DDI variable names, ready for
 * `buildDataCsv(variables, …)`. Non-question export columns (`id`,
 * `submitdate`, `lastpage`, …) are ignored.
 */
export function normalizeLimeSurveyResponses(
  variables: Variable[],
  responses: Submission[],
  options: NormalizeResponsesOptions = {},
): Submission[] {
  const warn = options.onWarning ?? (() => {});
  const warned = new Set<string>();
  const warnOnce = (message: string): void => {
    if (warned.has(message)) return;
    warned.add(message);
    warn(message);
  };
  // `<base>_other` companions of selects that carry the native `other` option.
  const otherBases = new Map<string, string>();
  for (const v of variables) {
    if (v.choices.some((c) => c.name === OTHER_CODE)) {
      otherBases.set(v.name + OTHER_SUFFIX, v.name);
    }
  }

  return responses.map((row) => {
    const { simple, bracketed } = splitRow(row);
    const out: Submission = {};
    for (const v of variables) {
      const key = normKey(v.name);
      if (v.type === 'select_multiple') {
        out[v.name] = multiValue(v, bracketed.get(key), warnOnce);
      } else if (isArrayMember(v)) {
        out[v.name] = subValue(bracketed.get(normKey(v.group)), v.name) ?? '';
      } else if (otherBases.has(v.name)) {
        // Authored companion (`qother`) or LimeSurvey's inline `q[other]`.
        const base = normKey(otherBases.get(v.name) as string);
        out[v.name] =
          simple.get(key) ??
          subValue(bracketed.get(base), LS_OTHER_SUBKEY) ??
          '';
      } else {
        const raw = simple.get(key) ?? '';
        out[v.name] =
          v.type === 'select_one' && raw === LS_OTHER_VALUE ? OTHER_CODE : raw;
      }
    }
    return out;
  });
}
