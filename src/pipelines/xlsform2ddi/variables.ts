/**
 * Flatten parsed XLSForm rows into an ordered {@link Variable} list.
 *
 * Source-agnostic: any adapter producing survey/choices rows can feed the DDI
 * emitter through here. Group nesting, choice resolution, and external-vocab
 * detection happen once, in registry-defined terms.
 */

import { APPEARANCES } from '../../generated/Appearances.js';
import conventions from '../../generated/conventions.json' with { type: 'json' };
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
const OTHER = conventions.conventions.other as {
  choiceCode?: string;
  companionSuffix?: string;
  companionType?: string;
  labels?: Record<string, string>;
  appliesTo?: string[];
};
const OTHER_CODE = OTHER.choiceCode ?? 'other';
const OTHER_SUFFIX = OTHER.companionSuffix ?? '_other';
const OTHER_COMPANION_TYPE = OTHER.companionType ?? 'text';
const OTHER_LABELS = OTHER.labels ?? {};
/** XLSForm type-string token marking the shorthand form. */
const OR_OTHER_TOKEN = 'or_other';

/** Types the convention applies to (registry: `convention:other.appliesTo`). */
const OTHER_TYPES = new Set(
  OTHER.appliesTo ?? ['select_one', 'select_multiple'],
);

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

/** Canonical "other" label for a language, falling back to English. */
function otherLabelFor(lang: string): string {
  return OTHER_LABELS[lang] ?? OTHER_LABELS['en'] ?? 'Other';
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
  if (
    baseType === 'select_one_from_file' ||
    baseType === 'select_multiple_from_file'
  ) {
    const filename = rawType.split(/\s+/).slice(1).join(' ');
    const vocab = filename.toLowerCase().endsWith('.csv')
      ? filename.slice(0, -'.csv'.length)
      : filename;
    return { stdType: baseType, listName: '', vocab };
  }
  return { stdType: TYPE_MAP[baseType] ?? baseType, listName: '', vocab: '' };
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
  // Names authored in the sheet: an explicitly written `<base>_other` companion
  // must not be duplicated by the `or_other` expansion below.
  const authoredNames = new Set(
    surveyRows.map((r) => toStr(r['name'])).filter(Boolean),
  );

  const variables: Variable[] = [];
  const groupStack: string[] = [];
  const groupMeta: Record<string, { label: string; appearance: string }> = {};

  for (const row of surveyRows) {
    const rawType = toStr(row['type']).trim();
    if (!rawType) continue;

    const baseType = rawType.split(/\s+/)[0];

    if (baseType === 'begin_group') {
      const gname = toStr(row['name']);
      groupStack.push(gname);
      groupMeta[gname] = {
        label: readLabel(row, labelCol),
        appearance: toStr(row['appearance']).toLowerCase(),
      };
      continue;
    }
    if (baseType === 'end_group') {
      groupStack.pop();
      continue;
    }
    if (SKIP_TYPES.has(baseType)) continue;
    if (NO_DATA_APPEARANCES.has(toStr(row['appearance']).trim().toLowerCase()))
      continue;

    const name = toStr(row['name']);
    if (!name) continue;

    const { stdType, listName, vocab } = resolveType(baseType, rawType);
    const curGroup = groupStack[groupStack.length - 1] ?? '';
    const gm = groupMeta[curGroup] ?? { label: '', appearance: '' };

    const group = groupStack.join('/');
    let choices = listName ? (choicesByList[listName] ?? []) : [];

    // `select_* <list> or_other` shorthand → the explicit pair the emitter
    // understands: an `other` category on the base list plus a `<base>_other`
    // free-text companion.
    const orOther =
      OTHER_TYPES.has(stdType) &&
      rawType.split(/\s+/).slice(1).includes(OR_OTHER_TOKEN);
    if (orOther && !choices.some((c) => c.name === OTHER_CODE)) {
      choices = [...choices, { name: OTHER_CODE, label: otherLabelFor(lang) }];
    }

    variables.push({
      name,
      type: stdType,
      label: readLabel(row, labelCol),
      group,
      groupLabel: gm.label,
      groupAppearance: gm.appearance,
      listName,
      vocab,
      choices,
    });

    const companionName = name + OTHER_SUFFIX;
    if (orOther && !authoredNames.has(companionName)) {
      variables.push({
        name: companionName,
        type: OTHER_COMPANION_TYPE,
        label: otherLabelFor(lang),
        group,
        groupLabel: gm.label,
        groupAppearance: gm.appearance,
        listName: '',
        vocab: '',
        choices: [],
      });
    }
  }

  return variables;
}
