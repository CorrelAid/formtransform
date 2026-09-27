/**
 * {@link Instrument} → the DDI's {@link Variable} list: the base language's
 * texts, with the form's other languages as `translations` (#135), flattened
 * in survey order with each variable's enclosing group path/label/appearance. Both DDI pipelines go through here (#69).
 */
import { METADATA_ROW_TYPES } from '../conventions/metadata.js';
import { APPEARANCES } from '../generated/Appearances.js';
import {
  OTHER_APPLIES_TO,
  OTHER_CODE,
  OTHER_COMPANION_TYPE,
  OTHER_SUFFIX,
  otherLabelFor,
} from '../conventions/other.js';
import { isFromFileType, vocabFromFilename } from '../conventions/fromFile.js';
import {
  TYPE_MAP,
  NON_DDI_EMITTABLE_TYPES,
  STRUCTURAL_TYPES,
} from '../generated/DdiMappings.js';
import type {
  Instrument,
  Item,
  QuestionItem,
  Text,
} from '../instrument/types.js';
import { warning, type WarningHandler } from '../diagnostics.js';
import { languageTagOf } from '../utils/languageUtils.js';
import type { Choice, Translations, Variable, VariableTexts } from './types.js';

// Semi-open "other" convention: the `or_other` type shorthand (and a
// LimeSurvey `other=Y`) is expanded into an `other` category plus a
// `<base>_other` text variable here, because the DDI emitter only recognizes
// the explicit pair (`detectOtherPatterns`).
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

/** Keep only the non-empty fields, so absent hints stay absent. */
function optionalText(
  fields: Record<'hint' | 'guidanceHint', string>,
): Partial<Record<'hint' | 'guidanceHint', string>> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
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
 * the first. This is the base language; the others go to `translations`.
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
  /** The group's label in every language, for its translations. */
  labelText: Text;
  appearance: string;
}

/**
 * The form's other languages the DDI can tag: every language but the base
 * one and the untagged, as `[key in Text, BCP 47 tag]`. A language without a
 * recognizable tag (`label::English`) has no `xml:lang` and is left out.
 */
function otherLanguages(
  instrument: Instrument,
  base: string | undefined,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const baseTag = base ? languageTagOf(base) : null;
  for (const key of instrument.languages) {
    const tag = key ? languageTagOf(key) : null;
    if (!tag || tag === baseTag || out.some(([, t]) => t === tag)) continue;
    out.push([key, tag]);
  }
  return out;
}

/** A text in each other language that has it (blank counts as absent). */
function translationsOf(
  text: Text | undefined,
  others: Array<[string, string]>,
): Translations | undefined {
  const out: Translations = {};
  for (const [key, tag] of others) {
    const value = text?.[key];
    if (value?.trim()) out[tag] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** A variable's texts in each other language that has any of them. */
function variableTranslations(
  fields: Partial<Record<keyof VariableTexts, Text>>,
  others: Array<[string, string]>,
): Record<string, VariableTexts> | undefined {
  const out: Record<string, VariableTexts> = {};
  for (const [field, text] of Object.entries(fields)) {
    for (const [tag, value] of Object.entries(
      translationsOf(text, others) ?? {},
    )) {
      (out[tag] ??= {})[field as keyof VariableTexts] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
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
  /** The form's other languages (see {@link otherLanguages}). */
  others: Array<[string, string]>;
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
  const translations = variableTranslations(
    {
      label: q.label,
      hint: q.hint,
      guidanceHint: q.guidanceHint,
      groupLabel: ctx.labelText,
    },
    state.others,
  );

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
    ...(translations ? { translations } : {}),
  });

  const companionName = q.name + OTHER_SUFFIX;
  if (!orOther || state.authoredNames.has(companionName)) return;
  // Only an authored label has translations; a synthesized one has none.
  const companionTranslations = variableTranslations(
    { label: q.otherLabel, groupLabel: ctx.labelText },
    state.others,
  );
  state.variables.push({
    name: companionName,
    type: OTHER_COMPANION_TYPE,
    label:
      (q.otherLabel && pick(q.otherLabel, state.lang)) ||
      otherLabelFor(state.otherLang),
    ...group,
    listName: '',
    vocab: '',
    choices: [],
    ...(companionTranslations ? { translations: companionTranslations } : {}),
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
        labelText: item.label,
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
 * The DDI's variables: an {@link Instrument}'s texts in the base language,
 * the other languages as `translations`, flattened in survey order (group
 * path/label/appearance on each). A non-base language without a tag can't be
 * marked with `xml:lang`, so it is left out with a `language-invalid` warning.
 */
export function variablesFromInstrument(
  instrument: Instrument,
  choicesByList: Record<string, Choice[]>,
  options: { language?: string; onWarning?: WarningHandler } = {},
): Variable[] {
  const preferred = options.language ?? instrument.defaultLanguage;
  const lang = projectionLanguage(instrument, preferred);
  for (const key of instrument.languages) {
    if (key && key !== lang && !languageTagOf(key)) {
      options.onWarning?.(
        warning(
          'language-invalid',
          `Language "${key}" has no language tag, so its texts are left out of the DDI; name it like "${key} (en)" or use the bare tag`,
        ),
      );
    }
  }
  const state: ProjectState = {
    variables: [],
    authoredNames: authoredNames(instrument.body),
    lang,
    otherLang: lang || 'en',
    others: otherLanguages(instrument, lang),
    choicesByList,
  };
  project(
    instrument.body,
    { path: '', label: '', labelText: {}, appearance: '' },
    state,
  );
  return state.variables;
}

/** An Instrument's choice lists in the base language, with translations. */
export function choicesFromInstrument(
  instrument: Instrument,
  language?: string,
): Record<string, Choice[]> {
  const lang = projectionLanguage(
    instrument,
    language ?? instrument.defaultLanguage,
  );
  const others = otherLanguages(instrument, lang);
  return Object.fromEntries(
    Object.entries(instrument.lists).map(([list, choices]) => [
      list,
      choices.map((c) => {
        const translations = translationsOf(c.label, others);
        return {
          name: c.name,
          label: pick(c.label, lang),
          ...(translations ? { translations } : {}),
        };
      }),
    ]),
  );
}
