/**
 * XLSForm sheets → {@link Instrument}. Accepts both row shapes the library
 * sees: `label::<lang>` columns (JSON fixtures, hand-built rows) and the
 * loader's `{ lang: text }` cells.
 */
import { allColumns, otherColumns } from '../conventions/columns.js';
import {
  OTHER_APPLIES_TO,
  OTHER_CODE,
  OTHER_COMPANION_TYPE,
  OTHER_SUFFIX,
} from '../conventions/other.js';
import { APPEARANCES } from '../generated/Appearances.js';
import { extractLanguageCode, languageTagOf } from '../utils/languageUtils.js';
import type {
  GroupItem,
  Instrument,
  InstrumentChoice,
  Item,
  QuestionItem,
  Text,
} from './types.js';

type Row = Record<string, unknown>;

const OR_OTHER_TOKEN = 'or_other';

/** Coerce a cell value to a string; objects/arrays/functions become `''`. */
export function cellString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/** The language tag of a `<column>::<lang>` header's suffix. */
function tagOf(column: string): string {
  return (
    extractLanguageCode(column) ?? column.slice(column.indexOf('::') + 2).trim()
  );
}

/**
 * The translations of `base` in a row: the plain column (tag `''`), each
 * `base::<lang>` column, and the entries of a `{ lang: text }` cell. Order is
 * the row's column order.
 */
export function readText(row: Row, base: string): Text {
  const text: Text = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === base) {
      if (value !== null && typeof value === 'object') {
        for (const [lang, v] of Object.entries(value as Row)) {
          text[lang] = cellString(v);
        }
      } else if (value !== undefined) {
        text[''] = cellString(value);
      }
    } else if (key.startsWith(`${base}::`)) {
      text[tagOf(key)] = cellString(value);
    }
  }
  return text;
}

/** The columns whose texts the model reads, in every language. */
const TEXT_COLUMNS = [
  'label',
  'label_short',
  'hint',
  'guidance_hint',
  'constraint_message',
  'concept',
];

/**
 * Language tags a row's texts use, label first, in column order: a language
 * only a hint has is still one of the form's (#160).
 */
function labelLanguages(row: Row): string[] {
  return TEXT_COLUMNS.flatMap((column) => Object.keys(readText(row, column)));
}

/** Parse `parameters`' `guidance_hint=<text>` (qwacback's encoding). */
function guidanceFromParameters(parameters: string): string {
  for (const part of parameters.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === 'guidance_hint') {
      return part.slice(eq + 1).trim();
    }
  }
  return '';
}

function isTrue(value: unknown): boolean {
  const s = cellString(value).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

/** Non-empty: some language has text. */
function hasText(text: Text): boolean {
  return Object.values(text).some((t) => t.trim());
}

function baseFields(row: Row, sheet: 'survey' | 'varGrp' | 'group' = 'survey') {
  const concept = readText(row, 'concept');
  // Only a varGrp has a labl (#181): elsewhere label_short is a column.
  const labelShort = sheet === 'survey' ? {} : readText(row, 'label_short');
  return {
    name: cellString(row['name']).trim(),
    label: readText(row, 'label'),
    hint: readText(row, 'hint'),
    ...(hasText(labelShort) ? { labelShort } : {}),
    ...(hasText(concept) ? { concept } : {}),
    relevant: cellString(row['relevant']).trim(),
    appearance: cellString(row['appearance']).trim().toLowerCase(),
    row,
    ...withColumns(otherColumns(row, sheet)),
  };
}

/** `columns`, absent when there are none. */
function withColumns(columns: Record<string, string>) {
  return Object.keys(columns).length ? { columns } : {};
}

/** What decides whether a question row becomes a `varGrp`. */
interface Shapes {
  /** Lists with an `other` choice. */
  otherLists: Set<string>;
  /** Names of the companion-typed (`text`) rows. */
  companions: Set<string>;
}

const NO_DATA = new Set(
  Object.entries(APPEARANCES)
    .filter(([, a]) => a.carriesData === false)
    .map(([name]) => name),
);

/**
 * The codebook makes it a `varGrp` (#181): a select_multiple, or a semi-open
 * question (convention:other: the or_other shorthand, or an `other` choice
 * and a `<name>_other` text question). Not a matrix header, which has no
 * data.
 */
function becomesVarGrp(row: Row, rawType: string, shapes: Shapes): boolean {
  const [type, list = '', ...rest] = rawType.split(/\s+/);
  const appearance = cellString(row['appearance']).trim().toLowerCase();
  if (NO_DATA.has(appearance)) return false;
  if (type === 'select_multiple') return true;
  if (!OTHER_APPLIES_TO.includes(type)) return false;
  const name = cellString(row['name']).trim();
  return (
    rest.includes(OR_OTHER_TOKEN) ||
    (shapes.otherLists.has(list) && shapes.companions.has(name + OTHER_SUFFIX))
  );
}

function question(row: Row, rawType: string, shapes: Shapes): QuestionItem {
  const [type, ...rest] = rawType.split(/\s+/);
  const fromFile = type.endsWith('_from_file');
  const parameters = cellString(row['parameters']);
  const guidance = readText(row, 'guidance_hint');
  const fromParams = guidanceFromParameters(parameters);
  if (!hasText(guidance) && fromParams) {
    guidance[''] = fromParams;
  }
  return {
    kind: 'question',
    ...baseFields(
      row,
      becomesVarGrp(row, rawType, shapes) ? 'varGrp' : 'survey',
    ),
    type,
    rawType,
    list: !fromFile && type.startsWith('select_') ? (rest[0] ?? '') : '',
    file: fromFile ? rest.join(' ') : '',
    orOther: rest.includes(OR_OTHER_TOKEN),
    guidanceHint: guidance,
    constraint: cellString(row['constraint']).trim(),
    constraintMessage: readText(row, 'constraint_message'),
    required: isTrue(row['required']),
    default: cellString(row['default']).trim(),
    parameters,
  };
}

/** Build the item tree from the survey sheet. */
function parseBody(survey: Row[], shapes: Shapes): Item[] {
  const root: Item[] = [];
  const stack: GroupItem[] = [];
  const append = (item: Item) =>
    (stack.length ? stack[stack.length - 1].children : root).push(item);
  for (const row of survey) {
    const rawType = cellString(row['type']).trim();
    if (!rawType) continue;
    if (/^begin[_ ]group$/.test(rawType)) {
      const guidance = readText(row, 'guidance_hint');
      const group: GroupItem = {
        kind: 'group',
        ...baseFields(row, 'group'),
        ...(hasText(guidance) ? { guidanceHint: guidance } : {}),
        children: [],
        closed: false,
      };
      append(group);
      stack.push(group);
    } else if (/^end[_ ]group$/.test(rawType)) {
      const closed = stack.pop();
      if (closed) {
        closed.closed = true;
        const { type: _, ...cells } = allColumns(row);
        if (Object.keys(cells).length) closed.endColumns = cells;
      }
    } else {
      append(question(row, rawType, shapes));
    }
  }
  return root;
}

function parseLists(choices: Row[]): Record<string, InstrumentChoice[]> {
  const lists: Record<string, InstrumentChoice[]> = {};
  for (const row of choices) {
    const list = cellString(row['list_name']);
    if (!list) continue;
    (lists[list] ??= []).push({
      name: cellString(row['name']),
      label: readText(row, 'label'),
      row,
      ...withColumns(otherColumns(row, 'choices')),
    });
  }
  return lists;
}

function shapesOf(
  survey: Row[],
  lists: Record<string, InstrumentChoice[]>,
): Shapes {
  return {
    otherLists: new Set(
      Object.entries(lists)
        .filter(([, choices]) => choices.some((c) => c.name === OTHER_CODE))
        .map(([list]) => list),
    ),
    companions: new Set(
      survey
        .filter((r) => cellString(r['type']).trim() === OTHER_COMPANION_TYPE)
        .map((r) => cellString(r['name']).trim()),
    ),
  };
}

/** Parse XLSForm sheets (survey, choices, settings rows) into an Instrument. */
export function instrumentFromXlsform(
  survey: Row[],
  choices: Row[] = [],
  settings: Row[] = [],
): Instrument {
  const languages: string[] = [];
  for (const row of [...survey, ...choices]) {
    for (const lang of labelLanguages(row)) {
      if (!languages.includes(lang)) languages.push(lang);
    }
  }
  const lists = parseLists(choices);
  const first = settings[0] ?? {};
  const defaultLanguage =
    typeof first['default_language'] === 'string'
      ? (languageTagOf(first['default_language']) ?? undefined)
      : undefined;
  return {
    languages: languages.length ? languages : [''],
    ...(defaultLanguage ? { defaultLanguage } : {}),
    settings: first,
    lists,
    body: parseBody(survey, shapesOf(survey, lists)),
  };
}
