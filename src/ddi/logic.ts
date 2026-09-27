/**
 * Skip logic and validation in the DDI (`convention:logicMapping`,
 * `ddiEncoding`; #151). DDI Codebook 2.5 has no expression syntax, so each
 * condition goes in twice:
 *
 * - readable, in the standard element: `<universe clusion="I">` prose built
 *   from the expression and the referenced questions' labels, and a simple
 *   numeric range as `<valrng><range>`;
 * - exact, in a typed note the reverse direction reads:
 *   `<notes type="cdl:relevant" subject="xlsform-xpath">${a} = 'x'</notes>`.
 */
import conventions from '../generated/conventions.js';
import { parseXPath, type XPathNode } from '../instrument/xpathParser.js';
import { rangeBounds } from './fields.js';
import { localizedChild } from './translations.js';
import type { Choice, Variable } from './types.js';
import type { XmlElement } from './xml.js';

const ENCODING = conventions.conventions.logicMapping.ddiEncoding;
const NOTES = ENCODING.notes;

interface ProseTemplate {
  prefix: string;
  and: string;
  or: string;
  not: string;
  selected: string;
  answered: string;
  unanswered: string;
  quotes: string[];
}

const TEMPLATES = ENCODING.universe.templates as Record<string, ProseTemplate>;

/** What the logic of one variable is written against. */
export interface LogicContext {
  /** Every variable by name, for the labels `${name}` refers to. */
  byName: Map<string, Variable>;
  /** The codebook's base language tag; `null` when undeclared. */
  base: string | null;
  /** The codebook's other language tags. */
  others: string[];
  /** The `<var>` or `<varGrp>` ID a `${name}` refers to (#153). */
  ids: Map<string, string>;
  /** Each data question's position in the form, from 1 (`qstn/@seqNo`). */
  seqNo: Map<string, number>;
  /** Lists whose choices' columns are written already (#160). */
  listsWritten: Set<string>;
}

/** The languages a variable's texts come in: its base and translations. */
export function logicContext(
  variables: Variable[],
  base: string | null,
  ids: Map<string, string> = new Map(),
): LogicContext {
  const others = new Set<string>();
  for (const v of variables) {
    for (const tag of Object.keys(v.translations ?? {})) others.add(tag);
  }
  return {
    byName: new Map(variables.map((v) => [v.name, v])),
    base,
    others: [...others].filter((t) => t !== base),
    ids,
    seqNo: new Map(
      variables
        .filter((v) => v.type !== 'note')
        .map((v, i): [string, number] => [v.name, i + 1]),
    ),
    listsWritten: new Set(),
  };
}

/** A variable's label in `tag` (`null`: the base language). */
function labelIn(v: Variable, tag: string | null): string | undefined {
  const text = tag === null ? v.label : v.translations?.[tag]?.label;
  return text?.trim() || undefined;
}

function choiceLabelIn(c: Choice, tag: string | null): string | undefined {
  const text = tag === null ? c.label : c.translations?.[tag];
  return text?.trim() || undefined;
}

const SYMBOLS: Record<string, string> = {
  '=': '=',
  '!=': '≠',
  '<': '<',
  '<=': '≤',
  '>': '>',
  '>=': '≥',
};

/** The mirror image of a comparison, for `literal op ${q}`. */
const MIRROR: Record<string, string> = {
  '=': '=',
  '!=': '!=',
  '<': '>',
  '<=': '>=',
  '>': '<',
  '>=': '<=',
};

/** Writes one condition in one language; `null` where it can't. */
class Prose {
  constructor(
    private readonly t: ProseTemplate,
    private readonly ctx: LogicContext,
    /** The language's tag in the variables' texts (`null`: base). */
    private readonly tag: string | null,
  ) {}

  private quote(text: string): string {
    return `${this.t.quotes[0]}${text}${this.t.quotes[1]}`;
  }

  private question(node: XPathNode): Variable | null {
    return node.kind === 'path' && node.name !== null
      ? (this.ctx.byName.get(node.name) ?? null)
      : null;
  }

  private questionText(v: Variable): string | null {
    const label = labelIn(v, this.tag);
    return label ? this.quote(label) : null;
  }

  /** A literal compared with `v`: its choice's label, else as written. */
  private value(node: XPathNode, v: Variable | null): string | null {
    if (node.kind === 'num') return node.text;
    if (node.kind !== 'str') {
      const other = this.question(node);
      return other ? this.questionText(other) : null;
    }
    const choice = v?.choices.find((c) => c.name === node.value);
    if (choice) return choiceLabelIn(choice, this.tag) ?? null;
    return this.quote(node.value);
  }

  private comparison(
    op: string,
    left: XPathNode,
    right: XPathNode,
  ): string | null {
    let q = this.question(left);
    let other = right;
    if (!q) {
      q = this.question(right);
      other = left;
      op = MIRROR[op];
    }
    if (!q) return null;
    const qText = this.questionText(q);
    if (!qText) return null;
    if (other.kind === 'str' && other.value === '') {
      if (op === '=') return this.t.unanswered.replace('{q}', qText);
      if (op === '!=') return this.t.answered.replace('{q}', qText);
      return null;
    }
    const value = this.value(other, q);
    return value === null ? null : `${qText} ${SYMBOLS[op]} ${value}`;
  }

  private call(name: string, args: XPathNode[]): string | null {
    if (name === 'not' && args.length === 1) {
      const inner = this.write(args[0]);
      return inner === null ? null : this.t.not.replace('{}', inner);
    }
    if (name !== 'selected' || args.length !== 2) return null;
    const q = this.question(args[0]);
    const qText = q ? this.questionText(q) : null;
    const value = q ? this.value(args[1], q) : null;
    if (!q || !qText || value === null || args[1].kind !== 'str') return null;
    return q.type === 'select_multiple'
      ? this.t.selected.replace('{q}', qText).replace('{v}', value)
      : `${qText} = ${value}`;
  }

  write(node: XPathNode): string | null {
    if (node.kind === 'call') return this.call(node.name, node.args);
    if (node.kind !== 'bin') return null;
    if (node.op === 'and' || node.op === 'or') {
      const sides = [node.left, node.right].map((side) => {
        const text = this.write(side);
        // A mixed and/or keeps its grouping.
        const nested =
          side.kind === 'bin' &&
          (side.op === 'and' || side.op === 'or') &&
          side.op !== node.op;
        return text !== null && nested ? `(${text})` : text;
      });
      if (sides.some((s) => s === null)) return null;
      return sides.join(` ${this.t[node.op]} `);
    }
    if (node.op in SYMBOLS) {
      return this.comparison(node.op, node.left, node.right);
    }
    return null;
  }
}

/** `${name}` as the parser's bare field name. */
function parse(expression: string): XPathNode | null {
  try {
    return parseXPath(expression.replace(/\$\{([^}]+)\}/g, '$1'));
  } catch {
    return null;
  }
}

/**
 * The universe sentence of a `relevant` expression in each language that
 * has a template and every label it names: base (`''`) first, then by tag.
 * Empty when the expression is outside what the prose covers.
 */
export function universeProse(
  relevant: string,
  ctx: LogicContext,
): Array<[string, string]> {
  const tree = parse(relevant);
  if (!tree) return [];
  const out: Array<[string, string]> = [];
  const baseTemplate =
    TEMPLATES[ctx.base ?? ENCODING.universe.untaggedLanguage];
  const langs: Array<[string, string | null, ProseTemplate | undefined]> = [
    ['', null, baseTemplate],
    ...ctx.others.map((tag): [string, string, ProseTemplate | undefined] => [
      tag,
      tag,
      TEMPLATES[tag],
    ]),
  ];
  for (const [lang, tag, t] of langs) {
    if (!t) continue;
    const text = new Prose(t, ctx, tag).write(tree);
    if (text) out.push([lang, `${t.prefix}${text}`]);
  }
  return out;
}

/**
 * All of `conditions` as one XPath: each parenthesized, ANDed; `''` when
 * none.
 */
function allOf(conditions: string[]): string {
  const parts = conditions.map((c) => c.trim()).filter(Boolean);
  return parts.length === 1
    ? parts[0]
    : parts.map((c) => `(${c})`).join(' and ');
}

/**
 * Who is asked: the enclosing groups' conditions and its own. The universe
 * states all of them; each note only its element's own.
 */
export function universeOf(v: Variable): string[] {
  return [...(v.groups ?? []).map((g) => g.relevant), v.relevant ?? ''];
}

/**
 * `<universe clusion="I">` per language for `conditions` (outermost first),
 * when there are any and the prose covers them all.
 */
export function addUniverse(
  el: XmlElement,
  conditions: string[],
  ctx: LogicContext,
): void {
  const relevant = allOf(conditions);
  if (!relevant) return;
  for (const [lang, text] of universeProse(relevant, ctx)) {
    el.textChild('universe', text, {
      clusion: ENCODING.universe.clusion,
      ...(lang ? { 'xml:lang': lang } : {}),
    });
  }
}

/** A `cdl:relevant` note for a group's own condition. */
export function addRelevantNote(el: XmlElement, relevant: string): void {
  if (!relevant) return;
  el.textChild('notes', relevant, {
    type: NOTES.relevant.type,
    subject: ENCODING.noteSubject,
  });
}

/** Bounds on `.` alone, as `<range>` attributes. */
export type Range = Partial<
  Record<'min' | 'minExclusive' | 'max' | 'maxExclusive', string>
>;

const RANGE_OPS = new Set(['<', '<=', '>', '>=']);

/** Bounds one `. op n` (or `n op .`) sets; `null` if it isn't one. */
function bound(node: XPathNode): Range | null {
  if (node.kind !== 'bin' || !RANGE_OPS.has(node.op)) return null;
  const self = (n: XPathNode) => n.kind === 'path' && n.name === null;
  const number = (n: XPathNode): string | null =>
    n.kind === 'num'
      ? n.text
      : n.kind === 'neg' && n.operand.kind === 'num'
        ? `-${n.operand.text}`
        : null;
  let op = node.op;
  let n = number(node.right);
  if (!(self(node.left) && n !== null)) {
    n = number(node.left);
    if (!(self(node.right) && n !== null)) return null;
    op = MIRROR[op] as typeof op;
  }
  switch (op) {
    case '>=':
      return { min: n };
    case '>':
      return { minExclusive: n };
    case '<=':
      return { max: n };
    default:
      return { maxExclusive: n };
  }
}

/**
 * A constraint that is only numeric bounds on the answer
 * (`. >= 1 and . <= 10`), as `<range>` attributes; `null` otherwise.
 */
export function simpleRange(constraint: string): Range | null {
  const tree = parse(constraint);
  if (!tree) return null;
  const range: Range = {};
  const conjuncts: XPathNode[] = [];
  const collect = (n: XPathNode) => {
    if (n.kind === 'bin' && n.op === 'and') {
      collect(n.left);
      collect(n.right);
    } else conjuncts.push(n);
  };
  collect(tree);
  for (const c of conjuncts) {
    const b = bound(c);
    if (!b) return null;
    for (const [k, val] of Object.entries(b) as Array<[keyof Range, string]>) {
      if (k in range || (k === 'min' && 'minExclusive' in range)) return null;
      if (k === 'minExclusive' && 'min' in range) return null;
      if (k === 'max' && 'maxExclusive' in range) return null;
      if (k === 'maxExclusive' && 'max' in range) return null;
      range[k] = val;
    }
  }
  return range;
}

const NUMERIC_TYPES = new Set(['integer', 'decimal', 'range']);

/**
 * `<valrng><range/></valrng>`: a numeric variable's simple constraint, else
 * a `range`'s `start`/`end` (#153).
 */
export function addValrng(el: XmlElement, v: Variable): void {
  const range =
    (v.constraint && NUMERIC_TYPES.has(v.type)
      ? simpleRange(v.constraint)
      : null) ?? (v.type === 'range' ? rangeBounds(v) : null);
  if (range) el.child('valrng').child('range', range);
}

/**
 * The typed notes of a variable's logic, in `convention:logicMapping`'s
 * order: relevant, constraint, constraint_message (per language), required.
 */
export function addLogicNotes(el: XmlElement, v: Variable): void {
  const subject = ENCODING.noteSubject;
  addRelevantNote(el, v.relevant ?? '');
  if (v.constraint) {
    el.textChild('notes', v.constraint, {
      type: NOTES.constraint.type,
      subject,
    });
  }
  if (v.constraintMessage) {
    const translations: Record<string, string> = {};
    for (const [tag, texts] of Object.entries(v.translations ?? {})) {
      if (texts.constraintMessage) translations[tag] = texts.constraintMessage;
    }
    localizedChild(el, 'notes', v.constraintMessage, translations, {
      type: NOTES.constraint_message.type,
    });
  }
  if (v.required) {
    el.textChild('notes', v.requiredCell ?? NOTES.required.text, {
      type: NOTES.required.type,
    });
  }
}
