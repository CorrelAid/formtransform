/**
 * Reconstruct an XLSForm (survey/choices/settings rows) from parsed LimeSurvey
 * structure-TSV rows — the reverse of `xlsformConverter`.
 *
 * Unlike `lstsv/toVariables.ts` (which feeds the deliberately lossy DDI
 * `Variable` model), this targets XLSForm itself, so it keeps relevance,
 * constraint, required, default, appearance and hint. `relevant`/`constraint`
 * are reversed via `reverseRelevance`/`reverseConstraint` (see
 * `./reverseExpressions.ts`, `./emParser.ts`) — inverting exactly the
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
 *     `decimal` is the canonical default.
 *   - a plain (non-grid) group's machine `name` is not recoverable — only its
 *     rendered label is in the TSV — so it is slugified from the label.
 */

import { defaultConfig } from '../../config/types.js';
import type { SurveyRow, ChoiceRow, SettingsRow } from '../../config/types.js';
import { APPEARANCES } from '../../generated/Appearances.js';
import { TYPE_MAPPINGS } from '../../generated/TypeMappings.js';
import {
  OTHER_CODE,
  OTHER_SUFFIX,
  otherLabelFor,
  vocabFromCssClass,
} from '../lstsv2ddi/toVariables.js';

import { formatDefaultLanguage } from './languageNames.js';
import { htmlToMarkdown } from '../../utils/markdownRenderer.js';
import {
  reverseRelevance,
  reverseConstraint,
  buildSelectContext,
  SelectContext,
} from './reverseExpressions.js';

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

// ── Registry-derived reverse type maps ──────────────────────────────────

/** LS `D` question → XLSForm type, keyed by its `dateFormat` hint (`''` = none). */
const DATE_TYPE_BY_FORMAT: Record<string, string> = {};
for (const [xfType, m] of Object.entries(TYPE_MAPPINGS)) {
  if (m.limeSurveyType === 'D')
    DATE_TYPE_BY_FORMAT[m.dateFormat ?? ''] = xfType;
}

/** Canonical XLSForm type for a LimeSurvey code with more than one alias. */
function canonicalTypeFor(lsCode: string): string {
  const candidates = Object.entries(TYPE_MAPPINGS)
    .filter(([, m]) => m.limeSurveyType === lsCode)
    .map(([k]) => k);
  // Prefer the modern/canonical spelling over legacy aliases (string→text,
  // int→integer); N (integer vs decimal) has no signal at all — decimal wins.
  return (
    candidates.find((c) => c === 'text' || c === 'decimal') ??
    candidates[0] ??
    'text'
  );
}
const CANONICAL_TEXT_TYPE = canonicalTypeFor('S');
const CANONICAL_NUMERIC_TYPE = canonicalTypeFor('N');

/** Appearance name → LS type-override code it produces (e.g. `minimal` → `!`). */
const APPEARANCE_BY_OVERRIDE: Record<string, string> = {};
for (const [name, spec] of Object.entries(APPEARANCES)) {
  if (spec.lsTypeOverride) APPEARANCE_BY_OVERRIDE[spec.lsTypeOverride] = name;
}

interface ResolvedType {
  base: string;
  appearance?: string;
}

/** Resolve a Q-row's `type/scale` (+ `date_format` hint) to an XLSForm type. */
function resolveType(lsCode: string, dateFormat: string): ResolvedType {
  const overrideAppearance = APPEARANCE_BY_OVERRIDE[lsCode];
  if (overrideAppearance) {
    const spec = APPEARANCES[overrideAppearance];
    return {
      base: spec.validForTypes?.[0] ?? CANONICAL_TEXT_TYPE,
      appearance: overrideAppearance,
    };
  }
  switch (lsCode) {
    case 'L':
      return { base: 'select_one' };
    case 'M':
      return { base: 'select_multiple' };
    case 'N':
      return { base: CANONICAL_NUMERIC_TYPE };
    case 'D':
      return {
        base:
          DATE_TYPE_BY_FORMAT[dateFormat] ?? DATE_TYPE_BY_FORMAT[''] ?? 'date',
      };
    case 'X':
      return { base: 'note' };
    default:
      return { base: CANONICAL_TEXT_TYPE };
  }
}

// ── Multi-language label collection ─────────────────────────────────────

/**
 * Accumulate `text`/`help` per (stable key, language) across every row, so a
 * later structural pass (over base-language rows only) can look up the full
 * multilingual value for any item regardless of row order.
 *
 * Keys: `G` rows use `type/scale` (LimeSurvey's own cross-language group
 * identity — the `name` column holds the rendered label, which differs per
 * language); every other class uses `name` (stable across languages).
 */
function collectLabelMaps(rows: Row[]): {
  textByKey: Map<string, Map<string, string>>;
  helpByKey: Map<string, Map<string, string>>;
} {
  const textByKey = new Map<string, Map<string, string>>();
  const helpByKey = new Map<string, Map<string, string>>();

  const put = (
    store: Map<string, Map<string, string>>,
    key: string,
    lang: string,
    value: string,
  ): void => {
    if (!value) return;
    (store.get(key) ?? store.set(key, new Map()).get(key)!).set(lang, value);
  };

  for (const row of rows) {
    const cls = cell(row, 'class');
    const lang = cell(row, 'language');
    if (!cls || !lang) continue;
    if (cls === 'G') {
      // G rows invert Q's columns: `name` holds the rendered label, `text`
      // holds the hint (see xlsformConverter#addGroup).
      const key = `G:${cell(row, 'type/scale')}`;
      put(textByKey, key, lang, cell(row, 'name'));
      put(helpByKey, key, lang, cell(row, 'text'));
      continue;
    }
    const key = `${cls}:${cell(row, 'name')}`;
    put(textByKey, key, lang, cell(row, 'text'));
    put(helpByKey, key, lang, cell(row, 'help'));
  }

  return { textByKey, helpByKey };
}

/** Collapse a per-language map to a plain string (1 language) or object map. */
function collapseLabel(
  map: Map<string, string> | undefined,
  languages: string[],
  baseLanguage: string,
): LabelValue {
  if (!map || map.size === 0) return '';
  if (languages.length <= 1) {
    return map.get(baseLanguage) ?? [...map.values()][0] ?? '';
  }
  const obj: Record<string, string> = {};
  for (const lang of languages) {
    const v = map.get(lang);
    if (v !== undefined) obj[lang] = v;
  }
  // Empty object would be truthy (breaks `label(...) || fallback` callers).
  return Object.keys(obj).length > 0 ? obj : '';
}

// ── Survey-level settings (S / SL rows) ─────────────────────────────────

interface SurveySettings {
  languages: string[];
  baseLanguage: string;
  formTitle: LabelValue;
  style: string;
  welcomeLabel?: LabelValue;
  endLabel?: LabelValue;
}

function readSettings(
  rows: Row[],
  textByKey: Map<string, Map<string, string>>,
): SurveySettings {
  const sRow = (name: string): Row | undefined =>
    rows.find((r) => cell(r, 'class') === 'S' && cell(r, 'name') === name);

  const baseLanguage = cell(sRow('language') ?? {}, 'text') || 'en';
  const additional = cell(sRow('additional_languages') ?? {}, 'text');
  const languages = additional
    ? [baseLanguage, ...additional.split(/\s+/).filter(Boolean)]
    : [baseLanguage];

  const format = cell(sRow('format') ?? {}, 'text');
  const style = format === 'G' ? 'pages' : '';

  const formTitle = collapseLabel(
    textByKey.get('SL:surveyls_title'),
    languages,
    baseLanguage,
  );
  const welcomeMap = textByKey.get('SL:surveyls_welcometext');
  const endMap = textByKey.get('SL:surveyls_endtext');

  return {
    languages,
    baseLanguage,
    formTitle,
    style,
    welcomeLabel: welcomeMap
      ? collapseLabel(welcomeMap, languages, baseLanguage)
      : undefined,
    endLabel: endMap
      ? collapseLabel(endMap, languages, baseLanguage)
      : undefined,
  };
}

// ── Group bucketing ──────────────────────────────────────────────────────

interface GroupBucket {
  seqKey: string;
  /** All rows (all languages) belonging to this group, in document order. */
  rows: Row[];
}

/** Split rows into per-group buckets. A `G` row starts a new bucket; there is
 * no explicit close row in LimeSurvey TSV — the next `G` row (or EOF) ends it. */
function splitIntoGroups(rows: Row[]): GroupBucket[] {
  const buckets: GroupBucket[] = [];
  let current: GroupBucket | null = null;
  for (const row of rows) {
    const cls = cell(row, 'class');
    if (cls === 'S' || cls === 'SL') continue;
    if (cls === 'G') {
      current = { seqKey: cell(row, 'type/scale'), rows: [] };
      buckets.push(current);
      continue;
    }
    current?.rows.push(row);
  }
  return buckets;
}

// ── Question-level reconstruction ───────────────────────────────────────

interface PlainQuestion {
  kind: 'plain';
  name: string;
  lsType: string;
  cssclass: string;
  dateFormat: string;
  mandatory: string;
  defaultVal: string;
  otherFlag: boolean;
  relevance: string;
  emValidationQ: string;
}

interface ArrayQuestion {
  kind: 'array';
  name: string;
  subquestionNames: string[];
}

type LogicalQuestion = PlainQuestion | ArrayQuestion;

/** Walk one group's base-language rows into an ordered logical-question list. */
function readLogicalQuestions(
  baseRows: Row[],
  languages: string[],
): { items: LogicalQuestion[]; choicesByName: Map<string, string[]> } {
  const items: LogicalQuestion[] = [];
  const choicesByName = new Map<string, string[]>();
  let currentQuestionName: string | null = null;
  let currentArray: ArrayQuestion | null = null;

  for (const row of baseRows) {
    const cls = cell(row, 'class');
    if (cls === 'Q') {
      const lsType = cell(row, 'type/scale');
      const name = cell(row, 'name');
      if (lsType === 'F') {
        currentArray = { kind: 'array', name, subquestionNames: [] };
        items.push(currentArray);
        currentQuestionName = null;
      } else {
        currentArray = null;
        currentQuestionName = name;
        items.push({
          kind: 'plain',
          name,
          lsType,
          cssclass: cell(row, 'cssclass'),
          dateFormat: cell(row, 'date_format'),
          mandatory: cell(row, 'mandatory'),
          defaultVal: cell(row, 'default'),
          otherFlag: cell(row, 'other') === 'Y',
          relevance: cell(row, 'relevance'),
          emValidationQ: cell(row, 'em_validation_q'),
        });
        choicesByName.set(name, []);
      }
      continue;
    }
    if (cls === 'SQ' && currentArray) {
      currentArray.subquestionNames.push(cell(row, 'name'));
      choicesByName.set(cell(row, 'name'), []);
      continue;
    }
    if ((cls === 'A' || cls === 'SQ') && currentQuestionName) {
      choicesByName.get(currentQuestionName)!.push(cell(row, 'name'));
      continue;
    }
    if (cls === 'A' && currentArray) {
      // Shared answer scale for the array — keyed by the array's own name.
      (
        choicesByName.get(currentArray.name) ??
        choicesByName.set(currentArray.name, []).get(currentArray.name)!
      ).push(cell(row, 'name'));
    }
  }

  void languages; // reserved for future per-language choice ordering checks
  return { items, choicesByName };
}

// ── Group-name / appearance heuristic ────────────────────────────────────

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

// ── Main entry point ─────────────────────────────────────────────────────

export interface XlsformOutput {
  survey: SurveyRow[];
  choices: ChoiceRow[];
  settings: SettingsRow[];
}

/**
 * Reconstruct XLSForm survey/choices/settings rows from parsed LimeSurvey
 * structure-TSV rows. See the module docstring for scope and known lossy
 * reconstructions.
 */
export function lstsvRowsToXlsform(rows: Row[]): XlsformOutput {
  const { textByKey, helpByKey } = collectLabelMaps(rows);
  const settings = readSettings(rows, textByKey);
  const { languages, baseLanguage } = settings;

  const label = (key: string): LabelValue =>
    collapseLabel(textByKey.get(key), languages, baseLanguage);
  const help = (key: string): LabelValue =>
    collapseLabel(helpByKey.get(key), languages, baseLanguage);

  const buckets = splitIntoGroups(rows);

  // Pre-scan: relevance can reference any question in the document, not just
  // ones in its own group, so the selected()-reconstruction context (which
  // select_multiple questions exist, and their choice codes) must be built
  // globally before emission.
  const selectMultipleForCtx: Array<{ name: string; codes: string[] }> = [];
  for (const bucket of buckets) {
    const baseRows = bucket.rows.filter(
      (r) => cell(r, 'language') === baseLanguage,
    );
    const { items, choicesByName } = readLogicalQuestions(baseRows, languages);
    for (const item of items) {
      if (
        item.kind === 'plain' &&
        item.lsType === 'M' &&
        !vocabFromCssClass(item.cssclass)
      ) {
        selectMultipleForCtx.push({
          name: item.name,
          codes: choicesByName.get(item.name) ?? [],
        });
      }
    }
  }
  const selectCtx = buildSelectContext(selectMultipleForCtx);

  const survey: SurveyRow[] = [];
  const choices: ChoiceRow[] = [];

  if (settings.welcomeLabel) {
    survey.push({
      type: 'note',
      name: 'welcome',
      label: htmlLabel(settings.welcomeLabel),
    });
  }

  for (const bucket of buckets) {
    const baseRows = bucket.rows.filter(
      (r) => cell(r, 'language') === baseLanguage,
    );
    const groupLabel = label(`G:${bucket.seqKey}`);
    const groupLabelText =
      typeof groupLabel === 'string'
        ? groupLabel
        : (groupLabel[baseLanguage] ?? '');

    const { items, choicesByName } = readLogicalQuestions(baseRows, languages);
    const hasArray = items.some((i) => i.kind === 'array');

    const isSyntheticDefault =
      buckets.length === 1 &&
      groupLabelText === defaultConfig.defaults.groupName &&
      !hasArray;

    if (!isSyntheticDefault) {
      const arrayItem = items.find(
        (i): i is ArrayQuestion => i.kind === 'array',
      );
      let groupName: string;
      let groupAppearance: string | undefined;
      if (items.length === 1 && arrayItem) {
        groupName = arrayItem.name;
        groupAppearance = 'table-list';
      } else {
        groupName = slugifyGroupName(groupLabelText);
      }
      const groupRow: SurveyRow = {
        type: 'begin_group',
        name: groupName,
        label: htmlLabel(groupLabel),
      };
      if (groupAppearance) groupRow.appearance = groupAppearance;
      survey.push(groupRow);
    }

    emitQuestions(items, choicesByName, {
      label,
      help,
      languages,
      baseLanguage,
      survey,
      choices,
      selectCtx,
    });

    if (!isSyntheticDefault) {
      survey.push({ type: 'end_group' });
    }
  }

  if (settings.endLabel) {
    survey.push({
      type: 'note',
      name: 'end',
      label: htmlLabel(settings.endLabel),
    });
  }

  const settingsRow: SettingsRow = {};
  if (settings.baseLanguage !== defaultConfig.defaults.language) {
    settingsRow.default_language = formatDefaultLanguage(settings.baseLanguage);
  }
  const formTitleBase =
    typeof settings.formTitle === 'string'
      ? settings.formTitle
      : settings.formTitle[settings.baseLanguage];
  if (formTitleBase && formTitleBase !== defaultConfig.defaults.surveyTitle) {
    settingsRow.form_title = formTitleBase;
  }
  if (settings.style) settingsRow.style = settings.style;

  return {
    survey,
    choices,
    settings: Object.keys(settingsRow).length > 0 ? [settingsRow] : [],
  };
}

interface EmitCtx {
  label: (key: string) => LabelValue;
  help: (key: string) => LabelValue;
  languages: string[];
  baseLanguage: string;
  survey: SurveyRow[];
  choices: ChoiceRow[];
  selectCtx: SelectContext;
}

/** Emit survey/choice rows for one group's logical questions, in order,
 * reconstructing the `other` pattern across the base select + its companion. */
function emitQuestions(
  items: LogicalQuestion[],
  choicesByName: Map<string, string[]>,
  ctx: EmitCtx,
): void {
  const otherBaseNames = new Set(
    items
      .filter((i): i is PlainQuestion => i.kind === 'plain' && i.otherFlag)
      .map((i) => i.name),
  );

  for (const item of items) {
    if (item.kind === 'array') {
      emitArrayQuestion(item, choicesByName, ctx);
      continue;
    }

    const resolved = resolveType(item.lsType, item.dateFormat);
    let type = resolved.base;

    const vocab = vocabFromCssClass(item.cssclass);
    if (vocab) {
      type =
        type === 'select_one'
          ? 'select_one_from_file'
          : 'select_multiple_from_file';
      type = `${type} ${vocab}.csv`;
    } else if (type === 'select_one' || type === 'select_multiple') {
      const listName = item.name;
      type = `${type} ${listName}`;
      emitChoiceList(listName, choicesByName.get(item.name) ?? [], ctx);
      if (otherBaseNames.has(item.name)) {
        ctx.choices.push({
          list_name: listName,
          name: OTHER_CODE,
          label: perLanguageOtherLabel(ctx.languages),
        });
      }
    }

    const isOtherCompanion =
      resolved.base === CANONICAL_TEXT_TYPE &&
      item.name.endsWith(OTHER_CODE) &&
      otherBaseNames.has(item.name.slice(0, -OTHER_CODE.length));

    const row: SurveyRow = {
      type,
      name: isOtherCompanion
        ? item.name.slice(0, -OTHER_CODE.length) + OTHER_SUFFIX
        : item.name,
      label: htmlLabel(ctx.label(`Q:${item.name}`)),
    };
    const helpVal = ctx.help(`Q:${item.name}`);
    if (helpVal) row.hint = htmlLabel(helpVal);
    if (item.mandatory === 'Y') row.required = 'yes';
    if (item.defaultVal) row.default = item.defaultVal;
    if (resolved.appearance) row.appearance = resolved.appearance;
    const relevant = reverseRelevance(item.relevance, ctx.selectCtx);
    if (relevant) row.relevant = relevant;
    const constraint = reverseConstraint(item.emValidationQ);
    if (constraint) row.constraint = constraint;

    ctx.survey.push(row);
  }
}

function perLanguageOtherLabel(languages: string[]): LabelValue {
  if (languages.length <= 1) return otherLabelFor(languages[0] ?? 'en');
  const obj: Record<string, string> = {};
  for (const lang of languages) obj[lang] = otherLabelFor(lang);
  return obj;
}

function emitChoiceList(listName: string, codes: string[], ctx: EmitCtx): void {
  for (const code of codes) {
    ctx.choices.push({
      list_name: listName,
      name: code,
      label: htmlLabel(ctx.label(`A:${code}`) || ctx.label(`SQ:${code}`)),
    });
  }
}

/** Emit a `table-list` grid: one `select_one` per subquestion, sharing the
 * array's own (already-legal) name as their synthesized list_name. */
function emitArrayQuestion(
  item: ArrayQuestion,
  choicesByName: Map<string, string[]>,
  ctx: EmitCtx,
): void {
  const listName = item.name;
  emitChoiceList(listName, choicesByName.get(item.name) ?? [], ctx);
  for (const sqName of item.subquestionNames) {
    ctx.survey.push({
      type: `select_one ${listName}`,
      name: sqName,
      label: htmlLabel(ctx.label(`SQ:${sqName}`)),
    });
  }
}
