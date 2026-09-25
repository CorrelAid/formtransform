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
 *     `decimal` is the canonical default. An `N` carrying the bound attributes
 *     a parameterized type declares (`range`) becomes that type; its `step` is
 *     only known to be 1 or fractional.
 *   - a plain (non-grid) group's machine `name` is not recoverable — only its
 *     rendered label is in the TSV — so it is slugified from the label.
 */

import { defaultConfig } from '../../config/types.js';
import type { SurveyRow, ChoiceRow, SettingsRow } from '../../xlsform/types.js';
import { APPEARANCES } from '../../generated/Appearances.js';
import { TYPE_MAPPINGS } from '../../generated/TypeMappings.js';
import { EXCLUSIVE_RULE } from '../../conventions/exclusive.js';
import {
  OTHER_CODE,
  OTHER_SUFFIX,
  otherLabelFor,
} from '../../conventions/other.js';
import {
  fromFileTypeFor,
  vocabFromCssClass,
} from '../../conventions/fromFile.js';
import { GRID_APPEARANCE } from '../../conventions/grid.js';

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

/** Types that write their XLSForm `parameters` into LS attributes (`range`). */
const PARAMETERIZED_TYPES = Object.entries(TYPE_MAPPINGS).filter(
  ([, m]) => m.parameterAttributes,
);

/**
 * The parameterized type whose LS attributes this row carries, with its
 * `parameters` cell rebuilt. `step` isn't stored: the integer-only flag means
 * a whole step (written as 1), otherwise it's left to the default.
 */
function resolveParameterized(
  lsCode: string,
  row: Row,
): ResolvedType | undefined {
  for (const [xfType, m] of PARAMETERIZED_TYPES) {
    if (m.limeSurveyType !== lsCode) continue;
    const attrs = Object.entries(m.parameterAttributes ?? {});
    if (!attrs.every(([, attr]) => cell(row, attr) !== '')) continue;
    const params = attrs.map(([key, attr]) => `${key}=${cell(row, attr)}`);
    const intOnly = m.integerOnly;
    if (intOnly && cell(row, intOnly.attribute) === '1') {
      for (const key of intOnly.whenWhole) {
        if (!m.parameterAttributes?.[key]) params.push(`${key}=1`);
      }
    }
    return { base: xfType, parameters: params.join(' ') };
  }
  return undefined;
}
const CANONICAL_NUMERIC_TYPE = canonicalTypeFor('N');

/** Appearance name → LS type-override code it produces (e.g. `minimal` → `!`). */
const APPEARANCE_BY_OVERRIDE: Record<string, string> = {};
for (const [name, spec] of Object.entries(APPEARANCES)) {
  if (spec.lsTypeOverride) APPEARANCE_BY_OVERRIDE[spec.lsTypeOverride] = name;
}

interface ResolvedType {
  base: string;
  appearance?: string;
  parameters?: string;
}

/** Resolve a Q-row's `type/scale` (+ attribute hints) to an XLSForm type. */
function resolveType(lsCode: string, row: Row): ResolvedType {
  const dateFormat = cell(row, 'date_format');
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
      return (
        resolveParameterized(lsCode, row) ?? { base: CANONICAL_NUMERIC_TYPE }
      );
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
  /** The Q row itself, for type-resolving attributes (date_format, bounds). */
  row: Row;
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
          row,
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

/** Pre-scan: walk every bucket's base-language rows to enumerate the `select_multiple`
 * questions in the document (so the `selected()` reconstruction context can be built
 * globally — relevance can reference any question, not just the current group). */
function collectSelectMultiples(
  buckets: GroupBucket[],
  baseLanguage: string,
  languages: string[],
): Array<{ name: string; codes: string[] }> {
  const out: Array<{ name: string; codes: string[] }> = [];
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
        out.push({
          name: item.name,
          codes: choicesByName.get(item.name) ?? [],
        });
      }
    }
  }
  return out;
}

/** Shared inputs for {@link emitBucketOpen}. */
interface BucketOpenCtx {
  bucket: GroupBucket;
  buckets: GroupBucket[];
  baseLanguage: string;
  baseRows: Row[];
  languages: string[];
  label: (key: string) => LabelValue;
}

/** Compute the begin-group row for one bucket. Returns `{ row, isSyntheticDefault }`:
 * when the bucket is the auto-injected single-default group, we elide the wrapper. */
function emitBucketOpen(ctx: BucketOpenCtx): {
  row: SurveyRow | null;
  isSyntheticDefault: boolean;
} {
  const { bucket, buckets, baseLanguage, baseRows, languages, label } = ctx;
  const groupLabel = label(`G:${bucket.seqKey}`);
  const groupLabelText =
    typeof groupLabel === 'string'
      ? groupLabel
      : (groupLabel[baseLanguage] ?? '');
  const { items } = readLogicalQuestions(baseRows, languages);
  const hasArray = items.some((i) => i.kind === 'array');
  const isSyntheticDefault =
    buckets.length === 1 &&
    groupLabelText === defaultConfig.defaults.groupName &&
    !hasArray;
  if (isSyntheticDefault) return { row: null, isSyntheticDefault: true };

  const arrayItem = items.find((i): i is ArrayQuestion => i.kind === 'array');
  let groupName: string;
  let groupAppearance: string | undefined;
  if (items.length === 1 && arrayItem) {
    groupName = arrayItem.name;
    groupAppearance = GRID_APPEARANCE;
  } else {
    groupName = slugifyGroupName(groupLabelText);
  }
  const row: SurveyRow = {
    type: 'begin_group',
    name: groupName,
    label: htmlLabel(groupLabel),
  };
  if (groupAppearance) row.appearance = groupAppearance;
  return { row, isSyntheticDefault: false };
}

/** Emit a bucket's rows + its (optional) begin/end_group wrappers into `ctx.survey`/`ctx.choices`. */
function emitBucket(
  bucket: GroupBucket,
  buckets: GroupBucket[],
  baseLanguage: string,
  languages: string[],
  ctx: EmitCtx,
): void {
  const baseRows = bucket.rows.filter(
    (r) => cell(r, 'language') === baseLanguage,
  );
  const { row: openRow, isSyntheticDefault } = emitBucketOpen({
    bucket,
    buckets,
    baseLanguage,
    baseRows,
    languages,
    label: ctx.label,
  });
  const { items, choicesByName } = readLogicalQuestions(baseRows, languages);
  if (openRow) ctx.survey.push(openRow);
  emitQuestions(items, choicesByName, ctx);
  if (!isSyntheticDefault) ctx.survey.push({ type: 'end_group' });
}

/** Render the settings sheet — non-default values only. */
function buildSettingsRow(settings: SurveySettings): SettingsRow[] {
  const row: SettingsRow = {};
  if (settings.baseLanguage !== defaultConfig.defaults.language) {
    row.default_language = formatDefaultLanguage(settings.baseLanguage);
  }
  const formTitleBase =
    typeof settings.formTitle === 'string'
      ? settings.formTitle
      : settings.formTitle[settings.baseLanguage];
  if (formTitleBase && formTitleBase !== defaultConfig.defaults.surveyTitle) {
    row.form_title = formTitleBase;
  }
  if (settings.style) row.style = settings.style;
  return Object.keys(row).length > 0 ? [row] : [];
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
  const selectCtx = buildSelectContext(
    collectSelectMultiples(buckets, baseLanguage, languages),
  );

  const survey: SurveyRow[] = [];
  const choices: ChoiceRow[] = [];
  const ctx: EmitCtx = {
    label,
    help,
    languages,
    baseLanguage,
    survey,
    choices,
    selectCtx,
  };

  if (settings.welcomeLabel) {
    survey.push({
      type: 'note',
      name: 'welcome',
      label: htmlLabel(settings.welcomeLabel),
    });
  }

  for (const bucket of buckets) {
    emitBucket(bucket, buckets, baseLanguage, languages, ctx);
  }

  if (settings.endLabel) {
    survey.push({
      type: 'note',
      name: 'end',
      label: htmlLabel(settings.endLabel),
    });
  }

  return {
    survey,
    choices,
    settings: buildSettingsRow(settings),
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

/** Set of question names whose base select natively carries `other=Y` (so the
 * `other` choice must be re-attached on the XLSForm side too). */
function collectOtherBaseNames(items: LogicalQuestion[]): Set<string> {
  return new Set(
    items
      .filter((i): i is PlainQuestion => i.kind === 'plain' && i.otherFlag)
      .map((i) => i.name),
  );
}

/** `select_*` (plain or `_from_file`) get their type string with the list or
 * vocab attached; non-selects pass through unchanged. */
function composeTypeWithList(
  base: string,
  item: PlainQuestion,
  otherBaseNames: Set<string>,
  choicesByName: Map<string, string[]>,
  ctx: EmitCtx,
): { type: string; emittedChoices: boolean } {
  const vocab = vocabFromCssClass(item.cssclass);
  if (vocab) {
    const fromFile = fromFileTypeFor(base);
    return { type: `${fromFile} ${vocab}.csv`, emittedChoices: false };
  }
  if (base === 'select_one' || base === 'select_multiple') {
    const listName = item.name;
    emitChoiceList(
      listName,
      choicesByName.get(item.name) ?? [],
      ctx,
      exclusiveCodes(item.row),
    );
    if (otherBaseNames.has(item.name)) {
      ctx.choices.push({
        list_name: listName,
        name: OTHER_CODE,
        label: perLanguageOtherLabel(ctx.languages),
      });
    }
    return { type: `${base} ${listName}`, emittedChoices: true };
  }
  return { type: base, emittedChoices: false };
}

/** True when this Q is the `<base>_other` free-text companion of a sibling select. */
function isOtherCompanionRow(
  resolvedBase: string,
  name: string,
  otherBaseNames: Set<string>,
): boolean {
  return (
    resolvedBase === CANONICAL_TEXT_TYPE &&
    name.endsWith(OTHER_CODE) &&
    otherBaseNames.has(name.slice(0, -OTHER_CODE.length))
  );
}

/** Resolve the per-row SurveyRow cell values from the precomputed item + ctx. */
function buildPlainQuestionRow(
  item: PlainQuestion,
  type: string,
  isOtherCompanion: boolean,
  resolved: ResolvedType,
  ctx: EmitCtx,
): SurveyRow {
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
  if (resolved.parameters) row.parameters = resolved.parameters;
  const relevant = reverseRelevance(item.relevance, ctx.selectCtx);
  if (relevant) row.relevant = relevant;
  const constraint = reverseConstraint(item.emValidationQ);
  if (constraint) row.constraint = constraint;
  return row;
}

/** Emit survey/choice rows for one group's logical questions, in order,
 * reconstructing the `other` pattern across the base select + its companion. */
function emitQuestions(
  items: LogicalQuestion[],
  choicesByName: Map<string, string[]>,
  ctx: EmitCtx,
): void {
  const otherBaseNames = collectOtherBaseNames(items);

  for (const item of items) {
    if (item.kind === 'array') {
      emitArrayQuestion(item, choicesByName, ctx);
      continue;
    }
    const resolved = resolveType(item.lsType, item.row);
    const { type } = composeTypeWithList(
      resolved.base,
      item,
      otherBaseNames,
      choicesByName,
      ctx,
    );
    const isOtherCompanion = isOtherCompanionRow(
      resolved.base,
      item.name,
      otherBaseNames,
    );
    ctx.survey.push(
      buildPlainQuestionRow(item, type, isOtherCompanion, resolved, ctx),
    );
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
  codes: string[],
  ctx: EmitCtx,
  exclusive: Set<string> = new Set(),
): void {
  for (const code of codes) {
    ctx.choices.push({
      list_name: listName,
      name: code,
      label: htmlLabel(ctx.label(`A:${code}`) || ctx.label(`SQ:${code}`)),
      ...(exclusive.has(code)
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
