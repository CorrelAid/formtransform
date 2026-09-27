/**
 * An {@link Instrument} in the form the DDI round trips compare (#154, #160):
 * what a DDI codebook can give back, with the losses
 * `src/pipelines/ddi2xlsform/README.md` lists folded out. Two instruments
 * that are the same form have equal canonical forms.
 */
import { APPEARANCES } from '../../../src/generated/Appearances.js';
import { TYPE_MAP } from '../../../src/generated/DdiMappings.js';
import { isMetadataType } from '../../../src/conventions/metadata.js';
import { OTHER_CODE } from '../../../src/conventions/other.js';
import { isExclusive } from '../../../src/conventions/exclusive.js';
import { allColumns } from '../../../src/conventions/columns.js';
import { languageTagOf } from '../../../src/utils/languageUtils.js';
import type {
  Instrument,
  Item,
  QuestionItem,
  Text,
} from '../../../src/instrument/types.js';

type Canon = Record<string, unknown>;

const NO_DATA = new Set(
  Object.entries(APPEARANCES)
    .filter(([, a]) => a.carriesData === false)
    .map(([name]) => name),
);
const ALIASES: Record<string, string> = { int: 'integer', string: 'text' };

interface Ctx {
  instrument: Instrument;
  /** Language key → the key compared. */
  lang: (key: string) => string;
  /** The lists the kept questions use. */
  lists: Set<string>;
  /** Lists of a select_multiple with an explicit other pair. */
  multiOther: Set<string>;
}

function text(t: Text | undefined, ctx: Ctx): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(t ?? {})) {
    const v = value.trim();
    if (v) out[ctx.lang(key)] ??= v;
  }
  return out;
}

/** The appearance cell: as authored when only its case differs. */
function appearance(item: Item): string {
  const cell = item.row['appearance'];
  const raw = typeof cell === 'string' ? cell.trim() : '';
  return raw && raw.toLowerCase() === item.appearance ? raw : item.appearance;
}

/** The `required` cell a required question has: as authored, else `yes`. */
function required(q: QuestionItem): string | false {
  if (!q.required) return false;
  const cell = q.row['required'];
  return typeof cell === 'string' && cell.trim() ? cell.trim() : 'yes';
}

/** Whether the DDI has it: a variable, a note or a row without data. */
function kept(q: QuestionItem): boolean {
  const type = ALIASES[q.type] ?? q.type;
  if (isMetadataType(type) || NO_DATA.has(q.appearance)) return !!q.name;
  return type in TYPE_MAP || type === 'note';
}

function question(q: QuestionItem, ctx: Ctx): Canon {
  const type = ALIASES[q.type] ?? q.type;
  if (q.list) ctx.lists.add(q.list);
  return {
    name: q.name,
    type,
    list: q.list,
    file: q.file,
    orOther: q.orOther,
    label: text(q.label, ctx),
    hint: text(q.hint, ctx),
    guidance: text(q.guidanceHint, ctx),
    relevant: q.relevant.trim(),
    constraint: q.constraint.trim(),
    constraintMessage: text(q.constraintMessage, ctx),
    required: required(q),
    default: q.default,
    appearance: appearance(q),
    parameters: q.parameters.trim(),
    columns: q.columns ?? {},
  };
}

function items(list: Item[], ctx: Ctx): Canon[] {
  const out: Canon[] = [];
  for (const item of list) {
    if (item.kind === 'group') {
      out.push({
        group: item.name,
        label: text(item.label, ctx),
        hint: text(item.hint, ctx),
        relevant: item.relevant.trim(),
        appearance: appearance(item),
        columns: item.columns ?? {},
        endColumns: item.endColumns ?? {},
        children: items(item.children, ctx),
      });
    } else if (!kept(item)) {
      continue;
    } else if (isMetadataType(ALIASES[item.type] ?? item.type)) {
      out.push({
        metadata: item.name,
        type: item.type,
        columns: item.columns ?? {},
      });
    } else if (item.type === 'note') {
      out.push({
        note: item.name,
        label: text(item.label, ctx),
        hint: text(item.hint, ctx),
        relevant: item.relevant.trim(),
        appearance: appearance(item),
        columns: item.columns ?? {},
      });
    } else {
      out.push(question(item, ctx));
    }
  }
  return out;
}

/** Mark the lists of explicit select_multiple pairs (their other label is the convention's). */
function multiOthers(list: Item[], into: Set<string>, names: Set<string>) {
  for (const item of list) {
    if (item.kind === 'group') multiOthers(item.children, into, names);
    else if (item.type === 'select_multiple' && item.list) {
      if (names.has(`${item.name}_other`)) into.add(item.list);
    }
  }
}

function allNames(list: Item[], into = new Set<string>()): Set<string> {
  for (const item of list) {
    into.add(item.name);
    if (item.kind === 'group') allNames(item.children, into);
  }
  return into;
}

function lists(ctx: Ctx): Canon {
  const out: Canon = {};
  for (const name of [...ctx.lists].sort()) {
    out[name] = (ctx.instrument.lists[name] ?? []).map((c) =>
      c.name === OTHER_CODE && ctx.multiOther.has(name)
        ? { name: c.name }
        : {
            name: c.name,
            label: text(c.label, ctx),
            ...(isExclusive(c.row) ? { exclusive: true } : {}),
            columns: c.columns ?? {},
          },
    );
  }
  return out;
}

/** Settings by column: one per language for a `{ lang: text }` one. */
function settings(instrument: Instrument, ctx: Ctx): Canon {
  const { form_title: title, ...rest } = instrument.settings;
  const out: Canon = { ...allColumns(rest) };
  if (title && typeof title === 'object') {
    out['form_title'] = text(title as Text, ctx);
  } else if (typeof title === 'string' || typeof title === 'number') {
    if (String(title).trim()) out['form_title'] = String(title).trim();
  }
  return out;
}

/** The canonical form of an instrument for the DDI round trips. */
export function canonical(instrument: Instrument): Canon {
  const keys = instrument.languages.filter(Boolean);
  const tags = keys.map((k) => languageTagOf(k));
  const multilingual = new Set(tags.filter(Boolean)).size > 1;
  // A multilingual form's base: default_language, else its first language.
  const baseTag =
    instrument.defaultLanguage ?? (multilingual ? tags[0] : null) ?? '';
  const baseKey = keys.find((k) => languageTagOf(k) === baseTag) ?? baseTag;
  const ctx: Ctx = {
    instrument,
    // One language: every text is it. Several: an untagged column is the base's.
    lang: (key) => (!multilingual ? '' : key || baseKey),
    lists: new Set(),
    multiOther: new Set(),
  };
  multiOthers(instrument.body, ctx.multiOther, allNames(instrument.body));
  const body = items(instrument.body, ctx);
  return {
    base: baseTag,
    languages: multilingual ? keys : [],
    settings: settings(instrument, ctx),
    lists: lists(ctx),
    body,
  };
}
