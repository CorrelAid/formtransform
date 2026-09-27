/**
 * Reconstruct an XLSForm (survey/choices/settings rows) from parsed LimeSurvey
 * structure-TSV rows — the reverse of `xlsformConverter`.
 *
 * Unlike `lstsv/toVariables.ts` (which feeds the deliberately lossy DDI
 * `Variable` model), this targets XLSForm itself, so it keeps relevance,
 * constraint, required, default, appearance and hint. `relevant`/`constraint`
 * are reversed by the parser (instrumentFromLstsv with `expressions`) via
 * `reverseRelevance`/`reverseConstraint` (see
 * `src/instrument/reverseExpressions.ts`, `src/instrument/emParser.ts`) — inverting exactly the
 * LimeSurvey Expression Manager dialect the forward transpiler emits, and
 * rejecting anything else. `calculation` is not reversed — the `calculate`
 * XLSForm type isn't registered in the registry at all, so forward can't
 * produce one to reverse.
 *
 * Known lossy reconstructions (see `./README.md` for the full list):
 *   - `list_name` is synthesized (reused from the question's own name, or the
 *     array's name for a grid) — the original authored list name is not
 *     stored anywhere in the TSV.
 *   - `N` (integer vs decimal) has no distinguishing signal in LimeSurvey;
 *     `decimal` is the canonical default. An `N` carrying the bound attributes
 *     a parameterized type declares (`range`) becomes that type; its `step` is
 *     only known to be 1 or fractional.
 *   - a plain (non-grid) group's machine `name` is not recoverable — only its
 *     rendered label is in the TSV — so it is slugified from the label.
 */

import { defaultConfig } from '../../config/types.js';
import type { SurveyRow, ChoiceRow, SettingsRow } from '../../xlsform/types.js';
import { APPEARANCES } from '../../generated/Appearances.js';
import { EXCLUSIVE_RULE } from '../../conventions/exclusive.js';
import {
  OTHER_CODE,
  OTHER_COMPANION_TYPE,
  OTHER_SUFFIX,
  otherCompanionRelevance,
  otherLabelFor,
} from '../../conventions/other.js';
import { GRID_APPEARANCE } from '../../conventions/grid.js';

/** The registry appearance for a group shown as one page. */
const PAGE_APPEARANCE: keyof typeof APPEARANCES = 'field-list';

import { formatDefaultLanguage } from './languageNames.js';
import { instrumentFromLstsv } from '../../instrument/fromLstsv.js';
import type {
  GroupItem,
  Instrument,
  Item,
  QuestionItem,
  Text,
} from '../../instrument/types.js';
import { htmlToMarkdown } from '../../utils/markdownRenderer.js';

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

/** Best-effort machine name for a plain group whose original name is lost —
 * only its rendered label survives in the TSV. */
function slugifyGroupName(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('');
  return slug || 'group';
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
  /** `format=G` (style: pages): each LimeSurvey group is one page. */
  pages: boolean;
}

/** Render the settings sheet — non-default values only. */
function buildSettingsRow(
  instrument: Instrument,
  baseLanguage: string,
): SettingsRow[] {
  const row: SettingsRow = {};
  if (baseLanguage !== defaultConfig.defaults.language) {
    row.default_language = formatDefaultLanguage(baseLanguage);
  }
  const title = instrument.settings['form_title'];
  if (
    typeof title === 'string' &&
    title &&
    title !== defaultConfig.defaults.surveyTitle
  ) {
    row.form_title = title;
  }
  const style = instrument.settings['style'];
  if (typeof style === 'string' && style) row.style = style;
  return Object.keys(row).length > 0 ? [row] : [];
}

/**
 * Reconstruct XLSForm survey/choices/settings rows from parsed LimeSurvey
 * structure-TSV rows: parsed into the Instrument (`instrumentFromLstsv`),
 * then emitted from it. See the module docstring for the known lossy
 * reconstructions.
 */
export function lstsvRowsToXlsform(rows: Row[]): XlsformOutput {
  return xlsformFromInstrument(
    instrumentFromLstsv(rows, { expressions: true }),
  );
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
    pages: instrument.settings['style'] === 'pages',
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
  const isGrid = group.appearance === GRID_APPEARANCE;
  const label = ctx.label(group.label);
  const text =
    typeof label === 'string' ? label : (label[ctx.baseLanguage] ?? '');
  const row: SurveyRow = {
    type: 'begin_group',
    name: isGrid ? group.name : slugifyGroupName(text),
    label: htmlLabel(label),
  };
  if (isGrid) row.appearance = GRID_APPEARANCE;
  // A page per group is what XLSForm's field-list group means.
  else if (ctx.pages) row.appearance = PAGE_APPEARANCE;
  if (group.relevant) row.relevant = group.relevant;
  ctx.survey.push(row);
  if (isGrid) emitGrid(group, ctx);
  else emitItems(group.children, ctx);
  ctx.survey.push({ type: 'end_group' });
}

/** A `table-list` grid: its shared list, then one `select_one` per row. */
function emitGrid(group: GroupItem, ctx: EmitCtx): void {
  emitChoiceList(group.name, ctx);
  for (const member of group.children) {
    if (member.kind !== 'question') continue;
    const row: SurveyRow = {
      type: `select_one ${group.name}`,
      name: member.name,
      label: htmlLabel(ctx.label(member.label)),
    };
    if (member.relevant) row.relevant = member.relevant;
    ctx.survey.push(row);
  }
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
  if (q.list) {
    emitChoiceList(q.list, ctx, exclusiveCodes(source));
    if (q.orOther) {
      ctx.choices.push({
        list_name: q.list,
        name: OTHER_CODE,
        label: perLanguageOtherLabel(ctx.languages),
      });
    }
  }
  const row: SurveyRow = {
    type: q.rawType,
    name: q.name,
    label: htmlLabel(ctx.label(q.label)),
  };
  const hint = ctx.label(q.hint);
  if (hint) row.hint = htmlLabel(hint);
  if (q.required) row.required = 'yes';
  if (q.default) row.default = q.default;
  if (q.appearance) row.appearance = q.appearance;
  if (q.parameters) row.parameters = q.parameters;
  if (q.relevant) row.relevant = q.relevant;
  if (q.constraint) row.constraint = q.constraint;
  const tip = ctx.label(q.constraintMessage);
  if (tip) row.constraint_message = htmlLabel(tip);
  ctx.survey.push(row);

  const companion = `${q.name}${OTHER_SUFFIX}`;
  if (q.orOther && !siblings.some((s) => s.name === companion)) {
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
  for (const choice of ctx.lists[listName] ?? []) {
    ctx.choices.push({
      list_name: listName,
      name: choice.name,
      label: htmlLabel(ctx.label(choice.label)),
      ...(exclusive.has(choice.name)
        ? { [EXCLUSIVE_RULE.choicesColumn]: EXCLUSIVE_RULE.trueValues[0] }
        : {}),
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
