/**
 * Flatten parsed XLSForm rows into an ordered {@link Variable} list.
 *
 * Source-agnostic: any adapter producing survey/choices rows can feed the DDI
 * emitter through here. Group nesting, choice resolution, and external-vocab
 * detection happen once, in registry-defined terms.
 */

import { extractLanguageCode } from '../../utils/languageUtils.js';
import { METADATA_ROW_TYPES } from '../../conventions/metadata.js';
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
import { instrumentFromXlsform } from '../../instrument/fromXlsform.js';
import type {
  Instrument,
  Item,
  QuestionItem,
  Text,
} from '../../instrument/types.js';

type Row = Record<string, unknown>;

// Semi-open "other" convention: the `or_other` type shorthand is expanded
// into an `other` category plus a `<base>_other` text variable here, because
// the DDI emitter only recognizes the explicit pair (`detectOtherPatterns`).

/** Types the convention applies to (registry: `convention:other.appliesTo`). */
const OTHER_TYPES = new Set(OTHER_APPLIES_TO);

/**
 * Types skipped during variable extraction: structural + non-emittable +
 * metadata, minus `note` (kept so note rows can be classified into `<preQTxt>`/`<notes>`).
 */
const SKIP_TYPES: Set<string> = new Set([
  ...[...STRUCTURAL_TYPES, ...NON_DDI_EMITTABLE_TYPES].filter(
    (t) => t !== 'note',
  ),
  // convention:unregisteredRows: device/session metadata (start, end,
  // deviceid, …) carries no authored content and is skipped, as in the
  // LimeSurvey TSV (#86).
  ...METADATA_ROW_TYPES,
]);

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

/**
 * The label column DDI text comes from: the `label::<tag>` of `language`
 * (settings.default_language) when there is one, else the first
 * `label::…`, else `label`.
 */
function findLabelCol(rows: Row[], language?: string): string {
  const first = rows[0];
  if (!first) return 'label';
  const cols = Object.keys(first).filter((k) => k.startsWith('label::'));
  const own = language
    ? cols.find((k) => extractLanguageCode(k) === language)
    : undefined;
  return own ?? cols[0] ?? 'label';
}

/**
 * Read a label cell, tolerating `{ lang: value }` maps: `language`'s value,
 * else the first.
 */
function readLabel(row: Row, col: string, language?: string): string {
  const raw = row[col] ?? row['label'];
  if (raw != null && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    return toStr((language && map[language]) ?? Object.values(map)[0]);
  }
  return toStr(raw);
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
  language?: string,
): Record<string, Choice[]> {
  const labelCol = findLabelCol(choiceRows, language);
  const out: Record<string, Choice[]> = {};
  for (const row of choiceRows) {
    const key = toStr(row['list_name']);
    if (!key) continue;
    (out[key] ??= []).push({
      name: toStr(row['name']),
      label: readLabel(row, labelCol, language),
    });
  }
  return out;
}

interface ResolvedType {
  stdType: string;
  listName: string;
  vocab: string;
}

/** Resolve a question's XLSForm type into a standardized type + list/vocab. */
function resolveType(q: QuestionItem): ResolvedType {
  if (
    q.type === 'select_one' ||
    q.type === 'select_multiple' ||
    q.type === 'rank'
  ) {
    return { stdType: q.type, listName: q.list, vocab: '' };
  }
  if (isFromFileType(q.type)) {
    return { stdType: q.type, listName: '', vocab: vocabFromFilename(q.file) };
  }
  return { stdType: TYPE_MAP[q.type] ?? q.type, listName: '', vocab: '' };
}

/**
 * One language of a {@link Text}: `lang`'s value, else the untagged one, else
 * the first. The DDI carries one language (#135 tracks the rest).
 */
function pick(text: Text, lang: string | undefined): string {
  if (lang !== undefined && lang in text) return text[lang];
  if ('' in text) return text[''];
  return Object.values(text)[0] ?? '';
}

/** The enclosing group a variable is emitted under. */
interface GroupContext {
  path: string;
  label: string;
  appearance: string;
}

/** What the projection needs besides the item itself. */
interface ProjectState {
  variables: Variable[];
  /** Names authored in the sheet: an explicit `<base>_other` wins over or_other. */
  authoredNames: Set<string>;
  /** The DDI's language (see {@link projectionLanguage}). */
  lang: string | undefined;
  /** The language of synthesized "other" labels. */
  otherLang: string;
  choicesByList: Record<string, Choice[]>;
}

/** True when the question is a data-carrying variable of the DDI. */
function emitsVariable(q: QuestionItem): boolean {
  if (!q.name || SKIP_TYPES.has(q.type)) return false;
  // A registry appearance with carriesData: false (a matrix header).
  return !NO_DATA_APPEARANCES.has(q.appearance);
}

function pushQuestion(
  q: QuestionItem,
  ctx: GroupContext,
  state: ProjectState,
): void {
  if (!emitsVariable(q)) return;
  const { stdType, listName, vocab } = resolveType(q);
  const orOther = q.orOther && OTHER_TYPES.has(stdType);
  const base = listName ? (state.choicesByList[listName] ?? []) : [];
  const choices =
    orOther && !base.some((c) => c.name === OTHER_CODE)
      ? [...base, { name: OTHER_CODE, label: otherLabelFor(state.otherLang) }]
      : base;
  const group = {
    group: ctx.path,
    groupLabel: ctx.label,
    groupAppearance: ctx.appearance,
  };

  state.variables.push({
    name: q.name,
    type: stdType,
    label: pick(q.label, state.lang),
    ...group,
    listName,
    vocab,
    choices,
    ...optionalText({
      hint: pick(q.hint, state.lang).trim(),
      guidanceHint: pick(q.guidanceHint, state.lang).trim(),
    }),
  });

  const companionName = q.name + OTHER_SUFFIX;
  if (!orOther || state.authoredNames.has(companionName)) return;
  state.variables.push({
    name: companionName,
    type: OTHER_COMPANION_TYPE,
    label: otherLabelFor(state.otherLang),
    ...group,
    listName: '',
    vocab: '',
    choices: [],
  });
}

function project(items: Item[], ctx: GroupContext, state: ProjectState): void {
  for (const item of items) {
    if (item.kind === 'question') {
      pushQuestion(item, ctx, state);
      continue;
    }
    project(
      item.children,
      {
        path: ctx.path ? `${ctx.path}/${item.name}` : item.name,
        label: pick(item.label, state.lang),
        appearance: item.appearance,
      },
      state,
    );
  }
}

function authoredNames(items: Item[], into = new Set<string>()): Set<string> {
  for (const item of items) {
    if (item.name) into.add(item.name);
    if (item.kind === 'group') authoredNames(item.children, into);
  }
  return into;
}

/**
 * The DDI's language: `preferred` (settings.default_language) when the form
 * has it, else the form's first language (`undefined` when untagged).
 */
function projectionLanguage(
  instrument: Instrument,
  preferred?: string,
): string | undefined {
  if (preferred && instrument.languages.includes(preferred)) return preferred;
  const first = instrument.languages[0];
  return first === '' ? preferred : first;
}

/**
 * The DDI's variables: an {@link Instrument} projected onto one language and
 * flattened in survey order (group path/label/appearance on each).
 */
export function variablesFromInstrument(
  instrument: Instrument,
  choicesByList: Record<string, Choice[]>,
  options: { language?: string } = {},
): Variable[] {
  const preferred = options.language ?? instrument.defaultLanguage;
  const lang = projectionLanguage(instrument, preferred);
  const state: ProjectState = {
    variables: [],
    authoredNames: authoredNames(instrument.body),
    lang,
    otherLang: lang || 'en',
    choicesByList,
  };
  project(instrument.body, { path: '', label: '', appearance: '' }, state);
  return state.variables;
}

/**
 * Extract a flat list of {@link Variable} from parsed survey rows.
 *
 * `choicesByList` maps a list name to its resolved options.
 */
export function extractVariables(
  surveyRows: Row[],
  choicesByList: Record<string, Choice[]>,
  options: { language?: string } = {},
): Variable[] {
  return variablesFromInstrument(
    instrumentFromXlsform(surveyRows),
    choicesByList,
    options,
  );
}
