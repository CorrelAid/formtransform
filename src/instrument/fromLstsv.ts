/**
 * LimeSurvey structure TSV rows → {@link Instrument}, in XLSForm's vocabulary:
 * LimeSurvey codes become XLSForm types (registry-driven, `lstsvTypes.ts`),
 * an `F` array becomes a table-list group, `other=Y` becomes `or_other`, and
 * each row's translations merge into one {@link Text} per field.
 *
 * With `expressions`, relevance and constraints are reversed from
 * LimeSurvey's Expression Manager into XPath (`reverseExpressions.ts`),
 * throwing `em-unsupported` on anything outside the forward dialect (or, with
 * `onWarning`, reporting it and leaving it out). Without, they stay `''`.
 */
import { OTHER_CODE, OTHER_SUFFIX } from '../conventions/other.js';
import { GRID_APPEARANCE } from '../conventions/grid.js';
import { EXCLUSIVE_RULE } from '../conventions/exclusive.js';
import type { APPEARANCES } from '../generated/Appearances.js';

/** The registry appearance for a group shown as one page. */
const PAGE_APPEARANCE: keyof typeof APPEARANCES = 'field-list';
import { fromFileTypeFor, vocabFromCssClass } from '../conventions/fromFile.js';
import { resolveType } from './lstsvTypes.js';
import {
  ConversionError,
  warning,
  type WarningHandler,
} from '../diagnostics.js';
import {
  buildSelectContext,
  reverseConstraint,
  reverseRelevance,
} from './reverseExpressions.js';
import { allItems, allQuestions } from './walk.js';
import type {
  GroupItem,
  Instrument,
  InstrumentChoice,
  Item,
  QuestionItem,
  Text,
} from './types.js';

type Row = Record<string, string>;

function cell(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

/** Per-field translations, keyed `<field>:<item key>`. */
type Translations = Map<string, Text>;

/**
 * Collect every row's per-language text. Keys: a G row by its sequence
 * (`type/scale`: its `name` is the rendered label, which differs per
 * language), a Q row by name, an A/SQ row by its question and code.
 */
function collectTranslations(rows: Row[]): Translations {
  const out: Translations = new Map();
  const put = (key: string, lang: string, value: string) => {
    if (!value) return;
    const text = out.get(key) ?? {};
    text[lang] = value;
    out.set(key, text);
  };
  const lastQ = new Map<string, string>();
  for (const row of rows) {
    const cls = cell(row, 'class');
    const lang = cell(row, 'language');
    if (cls === 'G') {
      const key = `G:${cell(row, 'type/scale')}`;
      put(`label:${key}`, lang, cell(row, 'name'));
      put(`hint:${key}`, lang, cell(row, 'text'));
    } else if (cls === 'Q') {
      const key = `Q:${cell(row, 'name')}`;
      lastQ.set(lang, cell(row, 'name'));
      put(`label:${key}`, lang, cell(row, 'text'));
      put(`hint:${key}`, lang, cell(row, 'help'));
      put(`tip:${key}`, lang, cell(row, 'em_validation_q_tip'));
      put(`other:${key}`, lang, cell(row, 'other_replace_text'));
    } else if (cls === 'A' || cls === 'SQ') {
      const key = `${cls}:${lastQ.get(lang) ?? ''}:${cell(row, 'name')}`;
      put(`label:${key}`, lang, cell(row, 'text'));
    } else if (cls === 'SL') {
      put(`label:SL:${cell(row, 'name')}`, lang, cell(row, 'text'));
    }
  }
  return out;
}

interface ParseState {
  tr: Translations;
  lists: Record<string, InstrumentChoice[]>;
  /** Selects with `other=Y`, by name: their `<name>other` text is the companion. */
  otherSelects: Set<string>;
  /** Group names given so far, to keep them unique. */
  groupNames: Set<string>;
}

const text = (state: ParseState, key: string): Text => ({
  ...(state.tr.get(key) ?? {}),
});

function emptyItem(row: Row) {
  return {
    name: cell(row, 'name'),
    hint: {},
    relevant: '',
    appearance: '',
    row,
  };
}

function arrayGroup(row: Row, state: ParseState): GroupItem {
  const name = cell(row, 'name');
  return {
    kind: 'group',
    ...emptyItem(row),
    label: text(state, `label:Q:${name}`),
    hint: text(state, `hint:Q:${name}`),
    appearance: GRID_APPEARANCE,
    children: [],
    closed: true,
  };
}

/** A Q row's XLSForm type, list and vocabulary file. */
function typeOf(row: Row) {
  const resolved = resolveType(cell(row, 'type/scale'), row);
  const vocab = vocabFromCssClass(cell(row, 'cssclass'));
  const isSelect =
    resolved.base === 'select_one' || resolved.base === 'select_multiple';
  const type =
    vocab && isSelect ? fromFileTypeFor(resolved.base) : resolved.base;
  const file = vocab ? `${vocab}.csv` : '';
  const list = vocab || !isSelect ? '' : cell(row, 'name');
  return {
    resolved,
    isSelect,
    type,
    file,
    list,
    rawType: [type, file || list].filter(Boolean).join(' '),
  };
}

/**
 * A TSV written before #79 carries the "other" companion as a text question
 * `<base>other` (the sanitized `<base>_other`): give it back its XLSForm name.
 */
function companionName(
  name: string,
  isText: boolean,
  state: ParseState,
): string {
  if (!isText || !name.endsWith(OTHER_CODE)) return name;
  const base = name.slice(0, -OTHER_CODE.length);
  return state.otherSelects.has(base) ? base + OTHER_SUFFIX : name;
}

function questionItem(row: Row, state: ParseState): QuestionItem {
  const code = cell(row, 'name');
  const key = `Q:${code}`;
  const t = typeOf(row);
  const orOther = t.isSelect && cell(row, 'other') === 'Y';
  if (orOther) state.otherSelects.add(code);
  const otherLabel = state.tr.has(`other:${key}`)
    ? { otherLabel: text(state, `other:${key}`) }
    : {};
  return {
    kind: 'question',
    ...emptyItem(row),
    name: companionName(code, t.resolved.base === 'text', state),
    label: text(state, `label:${key}`),
    hint: text(state, `hint:${key}`),
    appearance: t.resolved.appearance ?? '',
    type: t.type,
    rawType: t.rawType,
    list: t.list,
    file: t.file,
    orOther,
    guidanceHint: {},
    constraint: '',
    constraintMessage: text(state, `tip:${key}`),
    required: cell(row, 'mandatory') === 'Y',
    default: cell(row, 'default'),
    parameters: t.resolved.parameters ?? '',
    ...otherLabel,
  };
}

/** Whether a Q row's `exclude_all_others` lists `code`. */
function excludes(row: Record<string, unknown>, code: string): boolean {
  const value = row[EXCLUSIVE_RULE.limesurveyAttribute];
  return (typeof value === 'string' ? value : '')
    .split(EXCLUSIVE_RULE.limesurveySeparator)
    .some((c) => c.trim() === code);
}

/**
 * An A/SQ row: an option of `owner`'s list. A multiple choice's defaults sit
 * on its SQ rows as `Y`.
 */
function addChoice(
  row: Row,
  owner: string,
  question: QuestionItem | null,
  state: ParseState,
): void {
  const cls = cell(row, 'class');
  if (cls === 'SQ' && question && cell(row, 'default') === 'Y') {
    question.default = [question.default, cell(row, 'name')]
      .filter(Boolean)
      .join(' ');
  }
  const code = cell(row, 'name');
  (state.lists[owner] ??= []).push({
    name: code,
    label: text(state, `label:${cls}:${owner}:${code}`),
    // The question's exclude_all_others, on the choice as an XLSForm has it.
    row:
      question && excludes(question.row, code)
        ? {
            ...row,
            [EXCLUSIVE_RULE.choicesColumn]: EXCLUSIVE_RULE.trueValues[0],
          }
        : row,
  });
}

/** A name XLSForm (and a DDI `xs:ID`) accepts. */
const XLSFORM_NAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;

/**
 * A plain group's name: LimeSurvey's group name is its title, so one that is
 * no XLSForm name (`Über Sie`) is slugified (`bersie`), made unique.
 */
function groupName(title: string, state: ParseState): string {
  let name = title;
  if (!XLSFORM_NAME.test(name)) {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('');
    name = slug && !/^[0-9]/.test(slug) ? slug : `group${slug}`;
  }
  const base = name;
  for (let i = 2; state.groupNames.has(name); i++) name = `${base}_${i}`;
  state.groupNames.add(name);
  return name;
}

/** Walk the base-language rows into groups, questions and choice lists. */
function parseBody(baseRows: Row[], state: ParseState): Item[] {
  const body: Item[] = [];
  let group: GroupItem | null = null;
  let array: GroupItem | null = null;
  // The LimeSurvey code of the current non-array question (its list's name).
  let question = '';
  let current: QuestionItem | null = null;
  const into = () => (group ? group.children : body);
  for (const row of baseRows) {
    const cls = cell(row, 'class');
    if (cls === 'G') {
      group = {
        kind: 'group',
        ...emptyItem(row),
        name: groupName(cell(row, 'name'), state),
        label: text(state, `label:G:${cell(row, 'type/scale')}`),
        hint: text(state, `hint:G:${cell(row, 'type/scale')}`),
        children: [],
        // LimeSurvey groups end at the next G row.
        closed: true,
      };
      body.push(group);
      array = null;
      question = '';
      current = null;
    } else if (cls === 'Q' && cell(row, 'type/scale') === 'F') {
      array = arrayGroup(row, state);
      into().push(array);
      question = '';
      current = null;
    } else if (cls === 'Q') {
      array = null;
      question = cell(row, 'name');
      current = questionItem(row, state);
      into().push(current);
    } else if (cls === 'SQ' && array) {
      array.children.push(gridMember(row, array, state));
    } else if ((cls === 'A' || cls === 'SQ') && (array || question)) {
      addChoice(row, array ? array.name : question, current, state);
    }
  }
  return body.map(unwrapLoneArray);
}

function gridMember(
  row: Row,
  array: GroupItem,
  state: ParseState,
): QuestionItem {
  const name = cell(row, 'name');
  return {
    kind: 'question',
    ...emptyItem(row),
    label: text(state, `label:SQ:${array.name}:${name}`),
    type: 'select_one',
    rawType: `select_one ${array.name}`,
    list: array.name,
    file: '',
    orOther: false,
    guidanceHint: {},
    constraint: '',
    constraintMessage: {},
    required: cell(row, 'mandatory') === 'Y',
    default: '',
    parameters: '',
  };
}

/**
 * A group holding nothing but one array is how the forward path writes an
 * XLSForm table-list group (G row + F question): the group *is* the grid.
 */
function unwrapLoneArray(item: Item): Item {
  if (item.kind !== 'group' || item.children.length !== 1) return item;
  const only = item.children[0];
  return only.kind === 'group' && only.appearance === GRID_APPEARANCE
    ? only
    : item;
}

/**
 * The survey's welcome / end text as the XLSForm note it came from (the
 * forward path promotes `note` rows named `welcome` / `end`).
 */
function messageNote(
  name: string,
  setting: string,
  state: ParseState,
): QuestionItem[] {
  const label = text(state, `label:SL:${setting}`);
  if (Object.keys(label).length === 0) return [];
  const row = { type: 'note', name };
  return [
    {
      kind: 'question',
      ...emptyItem(row),
      label,
      type: 'note',
      rawType: 'note',
      list: '',
      file: '',
      orOther: false,
      guidanceHint: {},
      constraint: '',
      constraintMessage: {},
      required: false,
      default: '',
      parameters: '',
    },
  ];
}

/**
 * Fill each item's `relevant` (and each question's `constraint`) with the
 * XPath its source row's EM means. `selected()` needs every multiple choice's
 * codes, so this runs once the whole tree is parsed.
 */
function reverseAllExpressions(
  body: Item[],
  lists: Record<string, InstrumentChoice[]>,
  onWarning?: WarningHandler,
): void {
  const selectCtx = buildSelectContext(
    allQuestions(body)
      .filter((q) => q.type === 'select_multiple' && q.list)
      .map((q) => {
        const codes = (lists[q.list] ?? []).map((c) => c.name);
        return {
          name: q.name,
          codes: q.orOther ? [...codes, OTHER_CODE] : codes,
        };
      }),
  );
  // With a warning handler, an expression outside the dialect is reported
  // and left out; without one, it throws.
  const reverse = (item: Item, column: string, fn: (em: string) => string) => {
    try {
      return fn(cell(item.row as Row, column));
    } catch (error) {
      if (!onWarning || !(error instanceof ConversionError)) throw error;
      onWarning(
        warning(
          error.code,
          `${column} of "${item.name}" is left out: ${error.message}`,
          item.name,
        ),
      );
      return '';
    }
  };
  for (const item of allItems(body)) {
    item.relevant = reverse(item, 'relevance', (em) =>
      reverseRelevance(em, selectCtx),
    );
    if (item.kind === 'question') {
      item.constraint = reverse(item, 'em_validation_q', reverseConstraint);
    }
  }
}

export interface LstsvParseOptions {
  /** Reverse relevance/constraints into XPath (default: leave them empty). */
  expressions?: boolean;
  /**
   * With `expressions`: report an expression outside the dialect here and
   * leave it out, instead of throwing.
   */
  onWarning?: WarningHandler;
}

/**
 * `format=G` shows each group as one page, which is what an XLSForm
 * `field-list` group means: every group that isn't a grid is one.
 */
function markPages(items: Item[]): void {
  for (const item of items) {
    if (item.kind !== 'group') continue;
    if (!item.appearance) item.appearance = PAGE_APPEARANCE;
    markPages(item.children);
  }
}

/** Parse LimeSurvey structure-TSV rows into an Instrument. */
export function instrumentFromLstsv(
  rows: Row[],
  options: LstsvParseOptions = {},
): Instrument {
  const setting = (name: string) =>
    rows.find((r) => cell(r, 'class') === 'S' && cell(r, 'name') === name);
  const base = cell(setting('language') ?? {}, 'text');
  const extra = cell(setting('additional_languages') ?? {}, 'text')
    .split(/\s+/)
    .filter(Boolean);
  const languages = [...new Set([base, ...extra].filter(Boolean))];
  const title = rows.find(
    (r) =>
      cell(r, 'class') === 'SL' &&
      cell(r, 'name') === 'surveyls_title' &&
      (!base || cell(r, 'language') === base),
  );
  const state: ParseState = {
    tr: collectTranslations(rows),
    lists: {},
    otherSelects: new Set(),
    groupNames: new Set(),
  };
  const baseRows = rows.filter(
    (r) =>
      !['S', 'SL'].includes(cell(r, 'class')) &&
      (!base || cell(r, 'language') === base),
  );
  const body = [
    ...messageNote('welcome', 'surveyls_welcometext', state),
    ...parseBody(baseRows, state),
    ...messageNote('end', 'surveyls_endtext', state),
  ];
  if (options.expressions) {
    reverseAllExpressions(body, state.lists, options.onWarning);
  }
  const pages = cell(setting('format') ?? {}, 'text') === 'G';
  if (pages) markPages(body);
  return {
    languages: languages.length ? languages : [''],
    ...(base ? { defaultLanguage: base } : {}),
    settings: {
      ...(title ? { form_title: cell(title, 'text') } : {}),
      ...(pages ? { style: 'pages' } : {}),
    },
    lists: state.lists,
    body,
  };
}
