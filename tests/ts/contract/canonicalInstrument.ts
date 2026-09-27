/**
 * An {@link Instrument} in the form the DDI round trip compares (#154): what
 * a DDI codebook can give back, with the documented losses of
 * `src/pipelines/ddi2xlsform/README.md` folded out. Two instruments that are
 * the same form have equal canonical forms.
 */
import { APPEARANCES } from '../../../src/generated/Appearances.js';
import { TYPE_MAP } from '../../../src/generated/DdiMappings.js';
import { TYPE_MAPPINGS } from '../../../src/generated/TypeMappings.js';
import { METADATA_ROW_TYPES } from '../../../src/conventions/metadata.js';
import {
  OTHER_CODE,
  OTHER_SUFFIX,
  otherCompanionRelevance,
} from '../../../src/conventions/other.js';
import { isExclusive } from '../../../src/conventions/exclusive.js';
import { languageTagOf } from '../../../src/utils/languageUtils.js';
import { parseParameters } from '../../../src/utils/parameters.js';
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
const METADATA = new Set<string>(METADATA_ROW_TYPES);
const ALIASES: Record<string, string> = { int: 'integer', string: 'text' };

interface Ctx {
  instrument: Instrument;
  /** Language key → the tag compared (`''` for a one-language form). */
  lang: (key: string) => string;
  notes: string[];
}

function text(t: Text | undefined, ctx: Ctx): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(t ?? {})) {
    const v = value.trim();
    if (v) out[ctx.lang(key)] ??= v;
  }
  return out;
}

/** Parameters DDI keeps: no guidance_hint (it's ivuInstr), no default range bounds. */
function parameters(q: QuestionItem): string {
  const values = parseParameters(
    q.parameters
      .split(';')
      .filter((p) => !/^\s*guidance_hint\s*=/.test(p))
      .join(' '),
  );
  const defaults = TYPE_MAPPINGS[q.type]?.parameters ?? {};
  return Object.entries(values)
    .filter(([k, v]) => defaults[k] !== v)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(' ');
}

/** Whether DDI has a variable for it. */
function emitted(q: QuestionItem): boolean {
  const type = ALIASES[q.type] ?? q.type;
  return (
    !METADATA.has(type) &&
    !NO_DATA.has(q.appearance) &&
    (type in TYPE_MAP || type === 'note')
  );
}

function choices(q: QuestionItem, ctx: Ctx): Canon[] {
  const list = q.list ? (ctx.instrument.lists[q.list] ?? []) : [];
  const out: Canon[] = list.map((c) =>
    // The "other" answer's text is LimeSurvey's or the convention's.
    c.name === OTHER_CODE
      ? { name: c.name }
      : {
          name: c.name,
          label: text(c.label, ctx),
          ...(isExclusive(c.row) ? { exclusive: true } : {}),
        },
  );
  if (q.orOther && !out.some((c) => c.name === OTHER_CODE)) {
    out.push({ name: OTHER_CODE });
  }
  return out;
}

function question(q: QuestionItem, ctx: Ctx): Canon {
  const type = ALIASES[q.type] ?? q.type;
  const hasConstraint = !!q.constraint.trim();
  return {
    name: q.name,
    type,
    label: text(q.label, ctx),
    hint: text(q.hint, ctx),
    guidance: text(q.guidanceHint, ctx),
    relevant: q.relevant.trim(),
    constraint: q.constraint.trim(),
    constraintMessage: hasConstraint ? text(q.constraintMessage, ctx) : {},
    required: q.required,
    default: q.default,
    appearance: q.appearance,
    parameters: parameters(q),
    file: q.file,
    choices: choices(q, ctx),
  };
}

/** The or_other shorthand's companion, as the explicit pair writes it. */
function companion(q: QuestionItem): Canon {
  return {
    name: q.name + OTHER_SUFFIX,
    type: 'text',
    relevant: otherCompanionRelevance(q.type, q.name),
  };
}

/** A companion question compares by name, type and condition: its text is LimeSurvey's. */
function isCompanion(name: string, all: Set<string>): boolean {
  return (
    name.endsWith(OTHER_SUFFIX) && all.has(name.slice(0, -OTHER_SUFFIX.length))
  );
}

function items(list: Item[], ctx: Ctx, all: Set<string>): Canon[] {
  const out: Canon[] = [];
  for (const item of list) {
    if (item.kind === 'group') {
      const children = items(item.children, ctx, all);
      if (!children.length) continue;
      const label = text(item.label, ctx);
      out.push({
        group: item.name,
        label: Object.keys(label).length ? label : { '': item.name },
        hint: text(item.hint, ctx),
        relevant: item.relevant.trim(),
        appearance: item.appearance,
        children,
      });
      continue;
    }
    if (!emitted(item)) continue;
    if (item.type === 'note') {
      // Note rows come back without their names, merged, orphans at the end.
      const t = text(item.label, ctx);
      for (const part of Object.values(t).join('\n\n').split(/\n\n/)) {
        if (part.trim()) ctx.notes.push(part.trim());
      }
      continue;
    }
    const q = question(item, ctx);
    if (isCompanion(item.name, all)) {
      out.push({ name: q.name, type: q.type, relevant: q.relevant });
    } else {
      out.push(q);
    }
    if (item.orOther && !all.has(item.name + OTHER_SUFFIX)) {
      out.push(companion(item));
    }
  }
  return out;
}

function names(list: Item[], into = new Set<string>()): Set<string> {
  for (const item of list) {
    into.add(item.name);
    if (item.kind === 'group') names(item.children, into);
  }
  return into;
}

/** The canonical form of an instrument for the DDI round trip. */
export function canonical(instrument: Instrument): Canon {
  const tags = instrument.languages.map((l) => (l ? languageTagOf(l) : null));
  const single = new Set(tags.filter(Boolean)).size <= 1;
  // An untagged column of a multilingual form is its base language's text.
  const base =
    (instrument.defaultLanguage && languageTagOf(instrument.defaultLanguage)) ||
    tags.find(Boolean) ||
    '';
  const ctx: Ctx = {
    instrument,
    lang: (key) => (single ? '' : key ? (languageTagOf(key) ?? key) : base),
    notes: [],
  };
  const body = items(instrument.body, ctx, names(instrument.body));
  const s = instrument.settings;
  const setting = (k: string): unknown =>
    typeof s[k] === 'string' || typeof s[k] === 'number'
      ? String(s[k])
      : s[k] && typeof s[k] === 'object'
        ? text(s[k] as Text, ctx)
        : '';
  return {
    settings: {
      form_title: setting('form_title'),
      form_id: setting('form_id') || setting('id_string'),
      version: setting('version'),
      style: setting('style'),
    },
    body,
    notes: ctx.notes.sort(),
  };
}
