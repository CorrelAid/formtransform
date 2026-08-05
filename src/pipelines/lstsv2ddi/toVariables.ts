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

  // Array (`F`) accumulation: subquestions become individual select_one vars,
  // answers become the shared choice list, grouped as a grid.
  let inArray = false;
  let arrayName = '';
  let arrayLabel = '';
  let arrayGroup = '';
  let arraySubqs: Choice[] = [];
  let arrayAnswers: Choice[] = [];

  const flushArray = (): void => {
    if (!inArray) return;
    for (const sq of arraySubqs) {
      variables.push({
        name: sq.name,
        type: 'select_one',
        label: sq.label,
        group: arrayGroup,
        groupLabel: arrayLabel,
        groupAppearance: 'table-list',
        listName: arrayName,
        vocab: '',
        choices: arrayAnswers.map((a) => ({ ...a })),
      });
    }
    inArray = false;
    arrayName = '';
    arrayLabel = '';
    arrayGroup = '';
    arraySubqs = [];
    arrayAnswers = [];
  };

  for (const row of rows) {
    const cls = cell(row, 'class');
    const lang = cell(row, 'language');

    // Translations are duplicate rows; DDI needs one language only.
    if (baseLang && lang && lang !== baseLang) continue;

    switch (cls) {
      case 'S':
      case 'SL':
        continue;

      case 'G':
        flushArray();
        currentVar = null;
        currentGroup = cell(row, 'name');
        continue;

      case 'Q': {
        flushArray();
        currentVar = null;

        const lsType = cell(row, 'type/scale');
        const name = cell(row, 'name');
        const label = cell(row, 'text');
        const cdlVocab = vocabFromCssClass(cell(row, 'cssclass'));

        if (lsType === 'F') {
          inArray = true;
          arrayName = name;
          arrayLabel = label;
          // Group by the array's own machine name (matches the XLSForm→DDI grid
          // group id); the enclosing G row only carries the human label.
          arrayGroup = name;
          arraySubqs = [];
          arrayAnswers = [];
          continue;
        }

        const variable = buildQuestionVar(
          lsType,
          name,
          label,
          cdlVocab,
          currentGroup,
        );

        // Native "other" on a select: mark for post-pass `other` category.
        const hasOther = cell(row, 'other') === 'Y';
        if (
          hasOther &&
          (variable.type === 'select_one' ||
            variable.type === 'select_multiple')
        ) {
          otherSelects.add(name);
        }

        // The free-text companion (`<base>other`, sanitized) → restore the
        // canonical `<base>_other` name so codebook detects the other pattern.
        if (variable.type === 'text' && name.endsWith(OTHER_CODE)) {
          const base = name.slice(0, -OTHER_CODE.length);
          if (otherSelects.has(base)) variable.name = base + OTHER_SUFFIX;
        }

        variables.push(variable);
        // from_file selects (vocab set) inline options in the TSV that DDI drops.
        currentVar = variable.vocab ? null : variable;
        continue;
      }

      case 'A':
      case 'SQ': {
        const choice: Choice = {
          name: cell(row, 'name'),
          label: cell(row, 'text'),
        };
        if (inArray) {
          if (cls === 'SQ') arraySubqs.push(choice);
          else arrayAnswers.push(choice);
        } else if (currentVar) {
          currentVar.choices.push(choice);
        }
        continue;
      }

      default:
        continue;
    }
  }

  flushArray();

  // Append the `other` category last on each native-other select (after its
  // real A/SQ options were collected), matching the XLSForm→DDI ordering.
  if (otherSelects.size === 0) return variables;

  const otherLabel = otherLabelFor(baseLang);
  for (const v of variables) {
    if (otherSelects.has(v.name)) {
      v.choices.push({ name: OTHER_CODE, label: otherLabel });
    }
  }

  // A native `other=Y` with no companion question in the TSV came from the
  // XLSForm `or_other` shorthand, which stores the typed-in answer as free text
  // (`aufmerksam[other]` in LimeSurvey). Synthesize the `<base>_other` text
  // companion so the pattern round-trips as the canonical `varGrp[@type=other]`
  // — without it, the appended `other` category is emitted as a plain category
  // (and on `select_multiple`, as a spurious boolean variable). Surveys that do
  // carry an explicit companion row keep it untouched.
  const names = new Set(variables.map((v) => v.name));
  const withCompanions: Variable[] = [];
  for (const v of variables) {
    withCompanions.push(v);
    const companionName = v.name + OTHER_SUFFIX;
    if (otherSelects.has(v.name) && !names.has(companionName)) {
      withCompanions.push({
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

  return withCompanions;
}
