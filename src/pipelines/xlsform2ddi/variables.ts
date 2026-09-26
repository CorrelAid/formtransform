/**
 * Flatten parsed XLSForm rows into an ordered {@link Variable} list.
 *
 * Source-agnostic: any adapter producing survey/choices rows can feed the DDI
 * emitter through here. Group nesting, choice resolution, and external-vocab
 * detection happen once, in registry-defined terms.
 */

import { APPEARANCES } from '../../generated/Appearances.js';
import {
  OTHER_APPLIES_TO,
  OTHER_CODE,
  OTHER_COMPANION_TYPE,
  OTHER_SUFFIX,
  otherLabelFor,
} from '../../conventions/other.js';
import {
  isFromFileType,
  vocabFromFilename,
} from '../../conventions/fromFile.js';
import {
  TYPE_MAP,
  NON_DDI_EMITTABLE_TYPES,
  STRUCTURAL_TYPES,
} from '../../generated/DdiMappings.js';

import { Choice, Variable } from '../../ddi/types.js';

type Row = Record<string, unknown>;

// Semi-open "other" convention. XLSForm has two ways to author it: an explicit
// `other` choice plus a `<base>_other` text question (what the registry entities
// do), or the `or_other` suffix on the type string, which is shorthand for
// exactly that pair. The DDI emitter only recognizes the explicit form
// (`detectOtherPatterns` in codebook.ts needs both halves), so the shorthand is
// expanded here — otherwise `or_other` produced no `other` category and no
// free-text variable at all, silently dropping a column both LimeSurvey and ODK
// store.
/** XLSForm type-string token marking the shorthand form. */
const OR_OTHER_TOKEN = 'or_other';

/** Types the convention applies to (registry: `convention:other.appliesTo`). */
const OTHER_TYPES = new Set(OTHER_APPLIES_TO);

/**
 * Language of the label column in use (`label::German (de)` → `de`), so the
 * synthesized category/companion labels match the survey's own language.
 */
function langFromLabelCol(labelCol: string): string {
  const paren = /\(([a-z]{2})\)\s*$/i.exec(labelCol);
  if (paren) return paren[1].toLowerCase();
  const suffix = labelCol.startsWith('label::')
    ? labelCol.slice('label::'.length).trim()
    : '';
  return /^[a-z]{2}$/i.test(suffix) ? suffix.toLowerCase() : 'en';
}

/**
 * Types skipped during variable extraction: structural + non-emittable,
 * minus `note` (kept so note rows can be classified into `<preQTxt>`/`<notes>`).
 */
const SKIP_TYPES: Set<string> = new Set(
  [...STRUCTURAL_TYPES, ...NON_DDI_EMITTABLE_TYPES].filter((t) => t !== 'note'),
);

/**
 * Appearances the registry marks `carriesData: false`: the row renders (a matrix
 * header shows the shared choice labels above the body rows) but stores no
 * response, so it is not a variable of the dataset. Both engines agree — neither
 * LimeSurvey nor a `table-list` grid produces a column for it.
 */
const NO_DATA_APPEARANCES: Set<string> = new Set(
  Object.entries(APPEARANCES)
    .filter(([, spec]) => spec.carriesData === false)
    .map(([appearance]) => appearance),
);

/** Coerce a cell value to a string; objects/arrays/functions become `''`. */
function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/** Prefer a `label::<lang>` column, else plain `label`. */
function findLabelCol(rows: Row[]): string {
  const first = rows[0];
  if (!first) return 'label';
  for (const key of Object.keys(first)) {
    if (key.startsWith('label::')) return key;
  }
  return 'label';
}

/** Read a label cell, tolerating `{ lang: value }` maps (first value wins). */
function readLabel(row: Row, col: string): string {
  const raw = row[col] ?? row['label'];
  if (raw != null && typeof raw === 'object') {
    const first = Object.values(raw as Record<string, unknown>)[0];
    return toStr(first);
  }
  return toStr(raw);
}

/**
 * A text column in the label column's language: `hint` next to `label`,
 * `hint::German (de)` next to `label::German (de)`. Tolerates the loader's
 * `{ lang: value }` shape (the label's language, else the first value).
 */
function readLangColumn(row: Row, base: string, labelCol: string): string {
  const suffix = labelCol.startsWith('label::')
    ? labelCol.slice('label'.length)
    : '';
  const raw = row[base + suffix] ?? row[base];
  if (raw != null && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    return toStr(map[langFromLabelCol(labelCol)] ?? Object.values(map)[0]);
  }
  return toStr(raw).trim();
}

/**
 * The guidance hint: the XLSForm `guidance_hint` column, else
 * `guidance_hint=<text>` in `parameters` (`;`-separated), which is how
 * qwacback's DDI → XLSForm export writes `<ivuInstr>`.
 */
function readGuidanceHint(row: Row, labelCol: string): string {
  const column = readLangColumn(row, 'guidance_hint', labelCol);
  if (column) return column;
  for (const part of toStr(row['parameters']).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === 'guidance_hint') {
      return part.slice(eq + 1).trim();
    }
  }
  return '';
}

/** Keep only the non-empty fields, so absent hints stay absent. */
function optionalText(
  fields: Record<'hint' | 'guidanceHint', string>,
): Partial<Record<'hint' | 'guidanceHint', string>> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
}

/** Normalize a raw choices map into `{ list_name: Choice[] }`. */
export function normalizeChoices(
  choicesByList: Record<string, Array<{ name?: unknown; label?: unknown }>>,
): Record<string, Choice[]> {
  const out: Record<string, Choice[]> = {};
  for (const [ln, items] of Object.entries(choicesByList)) {
    out[ln] = items.map((c) => ({
      name: toStr(c.name),
      label: toStr(c.label),
    }));
  }
  return out;
}

/** Build `{ list_name: Choice[] }` from a flat choices sheet. */
export function choicesByListFromRows(
  choiceRows: Row[],
): Record<string, Choice[]> {
  const labelCol = findLabelCol(choiceRows);
  const out: Record<string, Choice[]> = {};
  for (const row of choiceRows) {
    const key = toStr(row['list_name']);
    if (!key) continue;
    (out[key] ??= []).push({
      name: toStr(row['name']),
      label: readLabel(row, labelCol),
    });
  }
  return out;
}

interface ResolvedType {
  stdType: string;
  listName: string;
  vocab: string;
}

/** Resolve a raw XLSForm type string into a standardized type + list/vocab. */
function resolveType(baseType: string, rawType: string): ResolvedType {
  if (
    baseType === 'select_one' ||
    baseType === 'select_multiple' ||
    baseType === 'rank'
  ) {
    return {
      stdType: baseType,
      listName: rawType.split(/\s+/)[1] ?? '',
      vocab: '',
    };
  }
  if (isFromFileType(baseType)) {
    const filename = rawType.split(/\s+/).slice(1).join(' ');
    const vocab = vocabFromFilename(filename);
    return { stdType: baseType, listName: '', vocab };
  }
  return { stdType: TYPE_MAP[baseType] ?? baseType, listName: '', vocab: '' };
}

/** Per-survey-row state shared by the helpers {@link extractVariables} dispatches to. */
interface ExtractState {
  variables: Variable[];
  groupStack: string[];
  groupMeta: Record<string, { label: string; appearance: string }>;
  /** Names authored in the sheet — guards against duplicating the `<base>_other`
   * companion when the source form already carries an explicit one. */
  authoredNames: Set<string>;
  /** Language of `label::<lang>` for the `or_other` synthesised labels. */
  lang: string;
  /** Source column for `label`, since sheets may use plain `label` or `label::<lang>`. */
  labelCol: string;
  /** Sheet's resolved choices keyed by list_name. */
  choicesByList: Record<string, Choice[]>;
}

/** Classify a survey row's `type` cell for the dispatch loop. */
type RowKind = 'open' | 'close' | 'skip' | 'question';

/** Mutating helpers used by {@link extractVariables}: keep {@link RowKind}
 * checks out of the loop body, so the loop stays a flat sequence of branches. */

function classifyRow(rawType: string, baseType: string): RowKind {
  if (rawType === 'begin_group') return 'open';
  if (rawType === 'end_group') return 'close';
  if (SKIP_TYPES.has(baseType)) return 'skip';
  return 'question';
}

function openGroup(row: Row, state: ExtractState): void {
  const name = toStr(row['name']);
  state.groupStack.push(name);
  state.groupMeta[name] = {
    label: readLabel(row, state.labelCol),
    appearance: toStr(row['appearance']).toLowerCase(),
  };
}

function closeGroup(state: ExtractState): void {
  state.groupStack.pop();
}

/** Inner-most enclosing group's stored label/appearance (defaults if outside any group). */
function currentGroupMeta(state: ExtractState): {
  label: string;
  appearance: string;
} {
  const cur = state.groupStack[state.groupStack.length - 1] ?? '';
  return state.groupMeta[cur] ?? { label: '', appearance: '' };
}

/** True when the `select_* <list> or_other` shorthand is present in `rawType`. */
function isOrOther(stdType: string, rawType: string): boolean {
  return (
    OTHER_TYPES.has(stdType) &&
    rawType.split(/\s+/).slice(1).includes(OR_OTHER_TOKEN)
  );
}

/** Run the `_or_other` expansion for one row's choice list (in place copy). */
function expandedChoices(
  baseChoices: Choice[],
  stdType: string,
  rawType: string,
  lang: string,
): Choice[] {
  if (!isOrOther(stdType, rawType)) return baseChoices;
  if (baseChoices.some((c) => c.name === OTHER_CODE)) return baseChoices;
  return [...baseChoices, { name: OTHER_CODE, label: otherLabelFor(lang) }];
}

/** Append the question variable + (when applicable) its `_other` companion. */
function pushQuestionRow(
  row: Row,
  baseType: string,
  rawType: string,
  state: ExtractState,
): void {
  const name = toStr(row['name']);
  if (!name) return;
  const { stdType, listName, vocab } = resolveType(baseType, rawType);
  const group = state.groupStack.join('/');
  const gm = currentGroupMeta(state);

  const baseChoices = listName ? (state.choicesByList[listName] ?? []) : [];
  const choices = expandedChoices(baseChoices, stdType, rawType, state.lang);

  state.variables.push({
    name,
    type: stdType,
    label: readLabel(row, state.labelCol),
    group,
    groupLabel: gm.label,
    groupAppearance: gm.appearance,
    listName,
    vocab,
    choices,
    ...optionalText({
      hint: readLangColumn(row, 'hint', state.labelCol),
      guidanceHint: readGuidanceHint(row, state.labelCol),
    }),
  });

  if (!isOrOther(stdType, rawType)) return;
  const companionName = name + OTHER_SUFFIX;
  if (state.authoredNames.has(companionName)) return;
  state.variables.push({
    name: companionName,
    type: OTHER_COMPANION_TYPE,
    label: otherLabelFor(state.lang),
    group,
    groupLabel: gm.label,
    groupAppearance: gm.appearance,
    listName: '',
    vocab: '',
    choices: [],
  });
}

/**
 * Extract a flat list of {@link Variable} from parsed survey rows.
 *
 * `choicesByList` maps a list name to its resolved options.
 */
export function extractVariables(
  surveyRows: Row[],
  choicesByList: Record<string, Choice[]>,
): Variable[] {
  const labelCol = findLabelCol(surveyRows);
  const lang = langFromLabelCol(labelCol);
  const authoredNames = new Set(
    surveyRows.map((r) => toStr(r['name'])).filter(Boolean),
  );

  const state: ExtractState = {
    variables: [],
    groupStack: [],
    groupMeta: {},
    authoredNames,
    lang,
    labelCol,
    choicesByList,
  };

  for (const row of surveyRows) {
    const rawType = toStr(row['type']).trim();
    if (!rawType) continue;
    const baseType = rawType.split(/\s+/)[0];
    const kind = classifyRow(rawType, baseType);

    if (kind === 'open') {
      openGroup(row, state);
    } else if (kind === 'close') {
      closeGroup(state);
    } else if (kind === 'skip') {
      continue;
    } else if (
      NO_DATA_APPEARANCES.has(toStr(row['appearance']).trim().toLowerCase())
    ) {
      continue;
    } else {
      pushQuestionRow(row, baseType, rawType, state);
    }
  }

  return state.variables;
}
