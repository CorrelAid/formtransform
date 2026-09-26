/**
 * XLSForm sheets → {@link Instrument}. Accepts both row shapes the library
 * sees: `label::<lang>` columns (JSON fixtures, hand-built rows) and the
 * loader's `{ lang: text }` cells.
 */
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

/** Language tags a row's label uses, in column order. */
function labelLanguages(row: Row): string[] {
  return Object.keys(readText(row, 'label'));
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

function baseFields(row: Row) {
  return {
    name: cellString(row['name']).trim(),
    label: readText(row, 'label'),
    hint: readText(row, 'hint'),
    relevant: cellString(row['relevant']).trim(),
    appearance: cellString(row['appearance']).trim().toLowerCase(),
    row,
  };
}

function question(row: Row, rawType: string): QuestionItem {
  const [type, ...rest] = rawType.split(/\s+/);
  const fromFile = type.endsWith('_from_file');
  const parameters = cellString(row['parameters']);
  const guidance = readText(row, 'guidance_hint');
  const fromParams = guidanceFromParameters(parameters);
  if (Object.values(guidance).every((t) => !t.trim()) && fromParams) {
    guidance[''] = fromParams;
  }
  return {
    kind: 'question',
    ...baseFields(row),
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
function parseBody(survey: Row[]): Item[] {
  const root: Item[] = [];
  const stack: GroupItem[] = [];
  const append = (item: Item) =>
    (stack.length ? stack[stack.length - 1].children : root).push(item);
  for (const row of survey) {
    const rawType = cellString(row['type']).trim();
    if (!rawType) continue;
    if (/^begin[_ ]group$/.test(rawType)) {
      const group: GroupItem = {
        kind: 'group',
        ...baseFields(row),
        children: [],
      };
      append(group);
      stack.push(group);
    } else if (/^end[_ ]group$/.test(rawType)) {
      stack.pop();
    } else {
      append(question(row, rawType));
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
    });
  }
  return lists;
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
  const first = settings[0] ?? {};
  const defaultLanguage =
    typeof first['default_language'] === 'string'
      ? (languageTagOf(first['default_language']) ?? undefined)
      : undefined;
  return {
    languages: languages.length ? languages : [''],
    ...(defaultLanguage ? { defaultLanguage } : {}),
    settings: first,
    lists: parseLists(choices),
    body: parseBody(survey),
  };
}
