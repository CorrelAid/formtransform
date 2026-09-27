/**
 * {@link Instrument} → XLSForm sheets (#69, phase 4): the emitter both
 * reverse paths share, `lstsv2xlsform` and `ddi2xlsform` (#154). It writes
 * what the model holds; what a source can't carry (LimeSurvey's list names)
 * the parsers fill in and their READMEs list.
 *
 * `relevant` / `constraint` are XPath already (the LimeSurvey parser reverses
 * EM, the DDI parser reads its `cdl:` notes). `calculation` is out of scope:
 * the `calculate` type is not registered, so no forward path produces one.
 */

import { defaultConfig } from '../config/types.js';
import type { SurveyRow, ChoiceRow, SettingsRow } from './types.js';
import { EXCLUSIVE_RULE, isExclusive } from '../conventions/exclusive.js';
import {
  OTHER_CODE,
  OTHER_COMPANION_TYPE,
  OTHER_SUFFIX,
  otherCompanionRelevance,
  otherLabelFor,
} from '../conventions/other.js';
import { GRID_APPEARANCE } from '../conventions/grid.js';

import { formatDefaultLanguage } from './languageNames.js';
import type {
  GroupItem,
  Instrument,
  Item,
  QuestionItem,
  Text,
} from '../instrument/types.js';
import { htmlToMarkdown } from '../utils/markdownRenderer.js';
import { languageTagOf } from '../utils/languageUtils.js';
import { withoutSpacedGuidance } from '../utils/parameters.js';

type Row = Record<string, string>;

type LabelValue = string | Record<string, string>;

function cell(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

/** Reverse HTML → markdown in a label, when the string looks like HTML. */
function htmlLabel(v: LabelValue): LabelValue {
  const isHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);
  if (typeof v === 'string') return isHtml(v) ? htmlToMarkdown(v) : v;
  return Object.fromEntries(
    Object.entries(v).map(([k, s]) => [k, isHtml(s) ? htmlToMarkdown(s) : s]),
  );
}

// ── Instrument → XLSForm (#69, phase 4) ──────────────────────────────────

/** Collapse a {@link Text} to a plain string (1 language) or `{lang: text}`. */
function collapseText(
  text: Text | undefined,
  languages: string[],
  baseLanguage: string,
): LabelValue {
  const entries = Object.entries(text ?? {}).filter(([, v]) => v !== '');
  if (entries.length === 0) return '';
  const map = new Map(entries);
  if (languages.length <= 1) {
    return map.get(baseLanguage) ?? entries[0][1] ?? '';
  }
  const obj: Record<string, string> = {};
  for (const lang of languages) {
    const v = map.get(lang);
    if (v !== undefined) obj[lang] = v;
  }
  // Empty object would be truthy (breaks `label(...) || fallback` callers).
  return Object.keys(obj).length > 0 ? obj : '';
}

export interface XlsformOutput {
  survey: SurveyRow[];
  choices: ChoiceRow[];
  settings: SettingsRow[];
}

interface EmitCtx {
  label: (text: Text | undefined) => LabelValue;
  languages: string[];
  baseLanguage: string;
  lists: Instrument['lists'];
  survey: SurveyRow[];
  choices: ChoiceRow[];
  /** Lists already written: a list shared by several questions is one list. */
  written: Set<string>;
}

/**
 * `default_language`: as the form had it (`Deutsch (de)`, `de`), else the
 * base language's English name when it isn't the default (`German (de)`).
 */
function defaultLanguageCell(
  instrument: Instrument,
  baseLanguage: string,
): string {
  const authored = instrument.settings['default_language'];
  if (
    typeof authored === 'string' &&
    (languageTagOf(authored) === baseLanguage || !instrument.defaultLanguage)
  ) {
    return authored;
  }
  return baseLanguage === defaultConfig.defaults.language
    ? ''
    : formatDefaultLanguage(baseLanguage);
}

/** Render the settings sheet — non-default values only. */
function buildSettingsRow(
  instrument: Instrument,
  baseLanguage: string,
): SettingsRow[] {
  const row: SettingsRow = {};
  const language = defaultLanguageCell(instrument, baseLanguage);
  if (language) row.default_language = language;
  const title = instrument.settings['form_title'];
  if (
    typeof title === 'string' &&
    title &&
    title !== defaultConfig.defaults.surveyTitle
  ) {
    row.form_title = title;
  } else if (title && typeof title === 'object') {
    // A title per language, as the form's own `form_title` was.
    row.form_title = title as Record<string, string>;
  }
  for (const [key, value] of Object.entries(instrument.settings)) {
    if (key === 'form_title' || key === 'default_language') continue;
    if ((typeof value === 'string' && value) || typeof value === 'number') {
      row[key] = String(value);
    }
  }
  return Object.keys(row).length > 0 ? [row] : [];
}

/** Emit an {@link Instrument} as XLSForm sheets. */
export function xlsformFromInstrument(instrument: Instrument): XlsformOutput {
  const baseLanguage =
    instrument.defaultLanguage ?? defaultConfig.defaults.language;
  const languages = instrument.defaultLanguage
    ? instrument.languages
    : [baseLanguage];
  const ctx: EmitCtx = {
    label: (text) => collapseText(text, languages, baseLanguage),
    languages,
    baseLanguage,
    lists: instrument.lists,
    survey: [],
    choices: [],
    written: new Set(),
  };
  const groups = instrument.body.filter((i) => i.kind === 'group');
  const content = instrument.body.filter((i) => !isMessageNote(i));
  for (const item of instrument.body) {
    if (item.kind === 'question') {
      emitQuestion(item, instrument.body, ctx);
    } else if (isSyntheticDefault(item, groups.length, content.length, ctx)) {
      emitItems(item.children, ctx);
    } else {
      emitGroup(item, ctx);
    }
  }
  return {
    survey: ctx.survey,
    choices: ctx.choices,
    settings: buildSettingsRow(instrument, baseLanguage),
  };
}

/** The welcome / end note the parser made from the survey's messages. */
function isMessageNote(item: Item): boolean {
  return (
    item.kind === 'question' &&
    item.rawType === 'note' &&
    (item.name === 'welcome' || item.name === 'end') &&
    !('class' in item.row)
  );
}

/**
 * The group the forward path adds when a form has none: a lone group with
 * the default name and no grid. Its questions come back ungrouped.
 */
function isSyntheticDefault(
  group: GroupItem,
  groupCount: number,
  contentCount: number,
  ctx: EmitCtx,
): boolean {
  const label = ctx.label(group.label);
  const text =
    typeof label === 'string' ? label : (label[ctx.baseLanguage] ?? '');
  return (
    groupCount === 1 &&
    contentCount === 1 &&
    group.appearance !== GRID_APPEARANCE &&
    !group.children.some((c) => c.kind === 'group') &&
    text === defaultConfig.defaults.groupName
  );
}

function emitItems(items: Item[], ctx: EmitCtx): void {
  for (const item of items) {
    if (item.kind === 'group') emitGroup(item, ctx);
    else emitQuestion(item, items, ctx);
  }
}

function emitGroup(group: GroupItem, ctx: EmitCtx): void {
  const row: SurveyRow = {
    type: 'begin_group',
    name: group.name,
    label: htmlLabel(ctx.label(group.label)),
  };
  const hint = ctx.label(group.hint);
  if (hint) row.hint = htmlLabel(hint);
  if (group.appearance) row.appearance = appearanceCell(group);
  if (group.relevant) row.relevant = group.relevant;
  Object.assign(row, group.columns);
  ctx.survey.push(row);
  emitItems(group.children, ctx);
  ctx.survey.push({ type: 'end_group', ...group.endColumns });
}

function emitQuestion(q: QuestionItem, siblings: Item[], ctx: EmitCtx): void {
  if (isMessageNote(q)) {
    ctx.survey.push({
      type: 'note',
      name: q.name,
      label: htmlLabel(ctx.label(q.label)),
    });
    return;
  }
  const source = q.row as Row;
  // Without the shorthand in its type (LimeSurvey's other=Y), the explicit pair.
  const expand = q.orOther && !/\sor_other\s*$/.test(q.rawType);
  if (q.list && !ctx.written.has(q.list)) {
    emitChoiceList(q.list, ctx, exclusiveCodes(source));
    if (expand) {
      ctx.choices.push({
        list_name: q.list,
        name: OTHER_CODE,
        label: perLanguageOtherLabel(ctx.languages),
      });
    }
  }
  ctx.survey.push(questionRow(q, ctx));

  const companion = `${q.name}${OTHER_SUFFIX}`;
  if (expand && !siblings.some((s) => s.name === companion)) {
    const label =
      ctx.label(q.otherLabel) || perLanguageOtherLabel(ctx.languages);
    ctx.survey.push({
      type: OTHER_COMPANION_TYPE,
      name: companion,
      label: htmlLabel(label),
      relevant: otherCompanionRelevance(q.type, q.name),
    });
  }
}

/** A question's survey row: every column it has a value for. */
function questionRow(q: QuestionItem, ctx: EmitCtx): SurveyRow {
  const row: SurveyRow = {
    type: q.rawType,
    name: q.name,
    label: htmlLabel(ctx.label(q.label)),
  };
  // A guidance_hint inside `parameters` stays there, unless pyxform would
  // reject it (text with spaces): then it is the guidance_hint column.
  const { parameters, moved } = withoutSpacedGuidance(q.parameters);
  const inParameters = !moved && /(^|;)\s*guidance_hint\s*=/.test(parameters);
  const texts: Array<[string, Text]> = [
    ['hint', q.hint],
    ...(inParameters
      ? []
      : [['guidance_hint', q.guidanceHint] as [string, Text]]),
    ['constraint_message', q.constraintMessage],
  ];
  for (const [column, text] of texts) {
    const value = ctx.label(text);
    if (value) row[column] = htmlLabel(value);
  }
  const plain: Array<[string, string]> = [
    ['required', q.required ? requiredCell(q) : ''],
    ['default', q.default],
    ['appearance', appearanceCell(q)],
    ['parameters', parameters],
    ['relevant', q.relevant],
    ['constraint', q.constraint],
  ];
  for (const [column, value] of plain) if (value) row[column] = value;
  // The columns the model doesn't lift, as the form had them (#160).
  Object.assign(row, q.columns);
  return row;
}

/** The appearance cell: as the source row had it (`Minimal`), else the model's. */
function appearanceCell(item: Item): string {
  const cell = item.row['appearance'];
  const raw = typeof cell === 'string' ? cell.trim() : '';
  return raw.toLowerCase() === item.appearance && raw ? raw : item.appearance;
}

/** The `required` cell: as the source row had it (`TRUE`), else `yes`. */
function requiredCell(q: QuestionItem): string {
  const cell = q.row['required'];
  return typeof cell === 'string' && cell.trim() ? cell.trim() : 'yes';
}

function perLanguageOtherLabel(languages: string[]): LabelValue {
  if (languages.length <= 1) return otherLabelFor(languages[0] ?? 'en');
  const obj: Record<string, string> = {};
  for (const lang of languages) obj[lang] = otherLabelFor(lang);
  return obj;
}

function emitChoiceList(
  listName: string,
  ctx: EmitCtx,
  exclusive: Set<string> = new Set(),
): void {
  ctx.written.add(listName);
  for (const choice of ctx.lists[listName] ?? []) {
    ctx.choices.push({
      list_name: listName,
      name: choice.name,
      label: htmlLabel(ctx.label(choice.label)),
      ...(exclusive.has(choice.name) || isExclusive(choice.row)
        ? { [EXCLUSIVE_RULE.choicesColumn]: EXCLUSIVE_RULE.trueValues[0] }
        : {}),
      ...choice.columns,
    });
  }
}

/** Codes in a Q row's `exclude_all_others` attribute (convention:exclusiveChoice). */
function exclusiveCodes(row: Row): Set<string> {
  const cellValue = cell(row, EXCLUSIVE_RULE.limesurveyAttribute);
  return new Set(
    cellValue
      .split(EXCLUSIVE_RULE.limesurveySeparator)
      .map((c) => c.trim())
      .filter(Boolean),
  );
}
