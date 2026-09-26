/**
 * LimeSurvey structure TSV rows → {@link Instrument}, in XLSForm's vocabulary:
 * LimeSurvey codes become XLSForm types (registry-driven, `lstsvTypes.ts`),
 * an `F` array becomes a table-list group, `other=Y` becomes `or_other`, and
 * each row's translations merge into one {@link Text} per field.
 *
 * Until the expression AST lands (#69, phase 5) `relevant` / `constraint`
 * stay empty here: LimeSurvey's are Expression Manager syntax, which only the
 * item's `row` carries.
 */
import { OTHER_CODE, OTHER_SUFFIX } from '../conventions/other.js';
import { GRID_APPEARANCE } from '../conventions/grid.js';
import { fromFileTypeFor, vocabFromCssClass } from '../conventions/fromFile.js';
import { resolveType } from './lstsvTypes.js';
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
    }
  }
  return out;
}

interface ParseState {
  tr: Translations;
  lists: Record<string, InstrumentChoice[]>;
  /** Selects with `other=Y`, by name: their `<name>other` text is the companion. */
  otherSelects: Set<string>;
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

/** Walk the base-language rows into groups, questions and choice lists. */
function parseBody(baseRows: Row[], state: ParseState): Item[] {
  const body: Item[] = [];
  let group: GroupItem | null = null;
  let array: GroupItem | null = null;
  // The LimeSurvey code of the current non-array question (its list's name).
  let question = '';
  const into = () => (group ? group.children : body);
  for (const row of baseRows) {
    const cls = cell(row, 'class');
    if (cls === 'G') {
      group = {
        kind: 'group',
        ...emptyItem(row),
        name: cell(row, 'name'),
        label: text(state, `label:G:${cell(row, 'type/scale')}`),
        hint: text(state, `hint:G:${cell(row, 'type/scale')}`),
        children: [],
        // LimeSurvey groups end at the next G row.
        closed: true,
      };
      body.push(group);
      array = null;
      question = '';
    } else if (cls === 'Q' && cell(row, 'type/scale') === 'F') {
      array = arrayGroup(row, state);
      into().push(array);
      question = '';
    } else if (cls === 'Q') {
      array = null;
      question = cell(row, 'name');
      into().push(questionItem(row, state));
    } else if (cls === 'SQ' && array) {
      array.children.push(gridMember(row, array, state));
    } else if ((cls === 'A' || cls === 'SQ') && (array || question)) {
      const owner = array ? array.name : question;
      (state.lists[owner] ??= []).push({
        name: cell(row, 'name'),
        label: text(state, `label:${cls}:${owner}:${cell(row, 'name')}`),
        row,
      });
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

/** Parse LimeSurvey structure-TSV rows into an Instrument. */
export function instrumentFromLstsv(rows: Row[]): Instrument {
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
  };
  const baseRows = rows.filter(
    (r) =>
      !['S', 'SL'].includes(cell(r, 'class')) &&
      (!base || cell(r, 'language') === base),
  );
  return {
    languages: languages.length ? languages : [''],
    ...(base ? { defaultLanguage: base } : {}),
    settings: {
      ...(title ? { form_title: cell(title, 'text') } : {}),
      ...(base ? { default_language: base } : {}),
      ...(cell(setting('format') ?? {}, 'text') === 'G'
        ? { style: 'pages' }
        : {}),
    },
    lists: state.lists,
    body: parseBody(baseRows, state),
  };
}
