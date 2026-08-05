/**
 * Read parsed LimeSurvey structure-TSV rows into the canonical {@link Variable}
 * model consumed by the DDI emitter (`src/ddi/`).
 *
 * This is the reverse direction of the XLSForm → LimeSurvey TSV path: it does
 * NOT reconstruct the original XLSForm (LimeSurvey TSV is lossy — names are
 * sanitized/truncated, relevance/constraints are transpiled to Expression
 * Manager syntax, and several XLSForm types collapse onto one LimeSurvey code).
 * The collapses are DDI-lossless, so this is enough to emit DDI:
 *   - `D` (date/time)      → `date`       (date and time emit identical DDI)
 *   - `N` (numeric)        → `decimal`    (decimal/integer emit identical DDI)
 *   - `S`/`T` (free text)  → `text`
 *   - `L` (list radio)     → `select_one`   (as does `!`, the dropdown)
 *   - `M` (multiple choice)→ `select_multiple`
 *   - `X` (text display)   → `note`
 *   - `F` (array)          → grid group of `select_one` variables
 */

import conventions from '../../generated/conventions.json' with { type: 'json' };

import { Choice, Variable } from '../../ddi/types.js';
import { APPEARANCES } from '../../generated/Appearances.js';

// Semi-open "other" convention: LimeSurvey carries it as a native `other=Y`
// flag (no code/label in the TSV), so the reverse path re-adds the `other`
// category from these per-language labels and rebuilds the `<base>_other`
// companion so the DDI emitter detects the pattern.
const OTHER = conventions.conventions.other as {
  choiceCode?: string;
  companionSuffix?: string;
  labels?: Record<string, string>;
};
/** LS answer code for the collapsed "other" choice (`convention:other`). */
export const OTHER_CODE = OTHER.choiceCode ?? 'other';
/** XLSForm companion-question suffix for the "other" free-text follow-up. */
export const OTHER_SUFFIX = OTHER.companionSuffix ?? '_other';
const OTHER_LABELS = OTHER.labels ?? {};

/** Canonical "other" category label for a survey language (falls back to en). */
export function otherLabelFor(lang: string): string {
  return OTHER_LABELS[lang] ?? OTHER_LABELS['en'] ?? 'Other';
}

/** LimeSurvey question-type code → canonical standardized type slug. */
const LS_TO_STD: Record<string, string> = {
  L: 'select_one',
  M: 'select_multiple',
  N: 'decimal',
  D: 'date',
  S: 'text',
  X: 'note',
  // Appearance overrides (`T`, `!`, …) are added from the registry below.
};

// An appearance can override the LimeSurvey type code the forward path emits
// (`multiline` → `T`, `minimal` → `!`). Those codes carry no type of their own,
// so the reverse path maps each back to the base XLSForm type the appearance is
// valid for. Derived from the registry rather than hardcoded: a new override in
// `registry/root.jsonld` teaches this path automatically, instead of silently
// falling back to `text` (which is how `!` used to degrade a dropdown
// select_one into free text).
for (const spec of Object.values(APPEARANCES)) {
  const code = spec.lsTypeOverride;
  const baseType = spec.validForTypes?.[0];
  if (!code || !baseType || code in LS_TO_STD) continue;
  // `string` is XLSForm's alias for `text`; every other base type is canonical.
  LS_TO_STD[code] = baseType === 'string' ? 'text' : baseType;
}

type Row = Record<string, string>;

/** Prefix of the `cssclass` value carrying external-vocab provenance. */
export const CDLVOCAB_PREFIX = 'cdlvocab-';

function cell(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

/**
 * Extract the vocabulary id from a Q-row's `cssclass` attribute, or `''`.
 *
 * `select_*_from_file` questions inline their options as A/SQ rows and record
 * provenance as `cssclass="cdlvocab-<id>"` (a registered LimeSurvey attribute
 * that survives import) — see `xlsformConverter`.
 */
export function vocabFromCssClass(cssclass: string): string {
  return cssclass.startsWith(CDLVOCAB_PREFIX)
    ? cssclass.slice(CDLVOCAB_PREFIX.length)
    : '';
}

/**
 * Build a non-array question {@link Variable} from its Q-row fields. A non-empty
 * `cdlVocab` marks a `select_*_from_file` question: its type gains the
 * `_from_file` suffix, `vocab` is set, and choices are dropped (DDI emits
 * `<concept vocab>` with no `<catgry>`).
 */
function buildQuestionVar(
  lsType: string,
  name: string,
  label: string,
  cdlVocab: string,
  group: string,
): Variable {
  let type = LS_TO_STD[lsType] ?? 'text';
  let vocab = '';
  let listName = '';

  if (cdlVocab) {
    vocab = cdlVocab;
    if (type === 'select_one') type = 'select_one_from_file';
    else if (type === 'select_multiple') type = 'select_multiple_from_file';
  } else if (type === 'select_one' || type === 'select_multiple') {
    // Synthetic list keyed by the question; choices fill from A/SQ rows.
    listName = name;
  }

  return {
    name,
    type,
    label,
    group,
    groupLabel: group,
    groupAppearance: '',
    listName,
    vocab,
    choices: [],
  };
}

/** Mutable accumulator for an in-flight `array` (`F` LimeSurvey type) row:
 * subquestion rows become individual `select_one` variables on flush, and
 * answer rows become the shared choice list they pull from. */
interface ArrayAccumulator {
  name: string;
  label: string;
  group: string;
  subquestions: Choice[];
  answers: Choice[];
}

/** Append the `other` category to each select that natively carries `other=Y`,
 * returning `variables` untouched when there are none (the common case). */
function appendOtherCategories(
  variables: Variable[],
  otherSelects: Set<string>,
  baseLang: string,
): Variable[] {
  if (otherSelects.size === 0) return variables;
  const otherLabel = otherLabelFor(baseLang);
  for (const v of variables) {
    if (otherSelects.has(v.name)) {
      v.choices.push({ name: OTHER_CODE, label: otherLabel });
    }
  }
  return variables;
}

/** Synthesize a `<base>_other` companion for every `other=Y` select that
 * doesn't already have one authored in the TSV (i.e. came from the XLSForm
 * `or_other` shorthand — LimeSurvey stores the free text inline). */
function appendOtherCompanions(
  variables: Variable[],
  otherSelects: Set<string>,
  baseLang: string,
): Variable[] {
  const names = new Set(variables.map((v) => v.name));
  const otherLabel = otherLabelFor(baseLang);
  const out: Variable[] = [];
  for (const v of variables) {
    out.push(v);
    const companionName = v.name + OTHER_SUFFIX;
    if (otherSelects.has(v.name) && !names.has(companionName)) {
      out.push({
        name: companionName,
        type: 'text',
        label: otherLabel,
        group: v.group,
        groupLabel: v.groupLabel,
        groupAppearance: v.groupAppearance,
        listName: '',
        vocab: '',
        choices: [],
      });
    }
  }
  return out;
}

/** Handle an `S`/`SL` row by skipping it (settings already parsed upstream). */
function isIgnorableSettingRow(cls: string): boolean {
  return cls === 'S' || cls === 'SL';
}

/** True when an `other=Y` row should mark its base select for post-pass `other`
 * reconstruction (only meaningful for `select_one` / `select_multiple`). */
function isOtherEligibleSelect(variable: Variable): boolean {
  return variable.type === 'select_one' || variable.type === 'select_multiple';
}

/** Apply the `<base>other → <base>_other` companion-rename rule: a free-text
 * variable whose sanitized name ends in `other` and whose base is registered
 * as a select with `other=Y` should be surfaced under the canonical suffix so
 * the DDI emitter's `varGrp[@type=other]` detection picks it up. */
function renameOtherCompanion(
  variable: Variable,
  otherSelects: Set<string>,
): void {
  if (variable.type !== 'text' || !variable.name.endsWith(OTHER_CODE)) return;
  const base = variable.name.slice(0, -OTHER_CODE.length);
  if (otherSelects.has(base)) variable.name = base + OTHER_SUFFIX;
}

/** Outcome from {@link processQuestionRow}: either a new array (`F` row) or a
 * a regular question variable to push. */
type QuestionRowOutcome =
  | { kind: 'array'; array: ArrayAccumulator }
  | { kind: 'question'; variable: Variable; currentVar: Variable | null };

/** Process a single Q-row: starts a new array, or builds a `Variable` and
 * updates the `other` companion registry. */
function processQuestionRow(
  row: Row,
  currentGroup: string,
  otherSelects: Set<string>,
  flushArray: () => void,
): QuestionRowOutcome {
  flushArray();
  const lsType = cell(row, 'type/scale');
  const name = cell(row, 'name');

  if (lsType === 'F') {
    return {
      kind: 'array',
      array: {
        name,
        label: cell(row, 'text'),
        // Group by the array's own machine name (matches the XLSForm→DDI grid
        // group id); the enclosing G row only carries the human label.
        group: name,
        subquestions: [],
        answers: [],
      },
    };
  }

  const label = cell(row, 'text');
  const cdlVocab = vocabFromCssClass(cell(row, 'cssclass'));
  const variable = buildQuestionVar(lsType, name, label, cdlVocab, currentGroup);

  if (cell(row, 'other') === 'Y' && isOtherEligibleSelect(variable)) {
    otherSelects.add(variable.name);
  }
  renameOtherCompanion(variable, otherSelects);

  // from_file selects (vocab set) inline options in the TSV that DDI drops.
  return { kind: 'question', variable, currentVar: variable.vocab ? null : variable };
}

/** Materialise `array` into one `select_one` Variable per subquestion. */
function drainArray(variables: Variable[], array: ArrayAccumulator): void {
  for (const sq of array.subquestions) {
    variables.push({
      name: sq.name,
      type: 'select_one',
      label: sq.label,
      group: array.group,
      groupLabel: array.label,
      groupAppearance: 'table-list',
      listName: array.name,
      vocab: '',
      choices: array.answers.map((a) => ({ ...a })),
    });
  }
}

/** Append one choice row either to the array bucket or to the most recent
 * non-array `Variable`. */
function attachChoice(
  cls: string,
  row: Row,
  array: ArrayAccumulator | null,
  currentVar: Variable | null,
): void {
  const choice: Choice = {
    name: cell(row, 'name'),
    label: cell(row, 'text'),
  };
  if (array) {
    if (cls === 'SQ') array.subquestions.push(choice);
    else array.answers.push(choice);
    return;
  }
  if (currentVar) currentVar.choices.push(choice);
}

/** Handle a `G` (group opener) row: flush any in-progress array and reset var state. */
function openGroup(row: Row, flushArray: () => void): string {
  flushArray();
  return cell(row, 'name');
}

/**
 * Flatten LimeSurvey structure-TSV rows into an ordered {@link Variable} list.
 *
 * Row classes: `S`/`SL` (survey settings, ignored here), `G` (group — its
 * `name` holds the rendered group label), `Q` (question), `A` (answer for
 * `select_one`/array), `SQ` (subquestion for `select_multiple`/array). `A`/`SQ`
 * rows attach to the most recent `Q`.
 */
export function lstsvToVariables(rows: Row[]): Variable[] {
  const baseLang =
    rows
      .find((r) => cell(r, 'class') === 'S' && cell(r, 'name') === 'language')
      ?.text?.trim() ?? '';

  const variables: Variable[] = [];
  // Base selects carrying LimeSurvey's native `other=Y`: an `other` category is
  // appended (post-pass) and the `<base>other` companion is renamed so the DDI
  // emitter reconstructs `varGrp[@type=other]`.
  const otherSelects = new Set<string>();

  // Current non-array question, so trailing A/SQ rows can attach their choices.
  let currentVar: Variable | null = null;
  // Group label carried by the enclosing `G` row (LimeSurvey has no group name).
  let currentGroup = '';
  // Array (`F`) accumulator; `null` means we're between arrays.
  let array: ArrayAccumulator | null = null;

  const flushArray = (): void => {
    if (!array) return;
    drainArray(variables, array);
    array = null;
  };

  for (const row of rows) {
    const cls = cell(row, 'class');

    // Translations are duplicate rows; DDI needs one language only.
    const lang = cell(row, 'language');
    if (baseLang && lang !== baseLang) continue;

    if (isIgnorableSettingRow(cls)) continue;

    if (cls === 'G') {
      currentGroup = openGroup(row, flushArray);
      currentVar = null;
      continue;
    }

    if (cls === 'Q') {
      const outcome = processQuestionRow(row, currentGroup, otherSelects, flushArray);
      if (outcome.kind === 'array') {
        array = outcome.array;
        continue;
      }
      variables.push(outcome.variable);
      currentVar = outcome.currentVar;
      continue;
    }

    if (cls === 'A' || cls === 'SQ') {
      attachChoice(cls, row, array, currentVar);
      continue;
    }
  }

  flushArray();

  appendOtherCategories(variables, otherSelects, baseLang);
  return appendOtherCompanions(variables, otherSelects, baseLang);
}
