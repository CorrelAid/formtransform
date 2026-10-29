/**
 * XPath to LimeSurvey Expression Transpiler
 *
 * Transpiles XLSForm XPath expressions to LimeSurvey Expression Manager (EM)
 * syntax: {@link parseXPath} builds an AST, and {@link transpile} walks it.
 * Parentheses are re-inserted wherever EM would otherwise bind differently from
 * the XPath source (the AST drops the source's own parentheses).
 *
 * A relevance or calculation that can't be parsed or uses an unsupported
 * function **throws**: silently replacing it with `1` ("always shown") would
 * drop skip logic from a TSV that still looks valid. Constraints keep their
 * documented fallback (`''`, i.e. no validation) — see {@link convertConstraint}.
 */

import { normalizeName } from '../../xlsform/identifiers.js';

import {
  PRECEDENCE,
  UNARY_PRECEDENCE,
  parseXPath,
  type BinaryOp,
  type XPathNode,
} from '../../instrument/xpathParser.js';
import { consoleWarning, warning } from '../../diagnostics.js';
import type { WarningHandler } from '../../diagnostics.js';
import { ConversionError } from '../../diagnostics.js';
import { COUNT_SELECTED } from '../../conventions/selectionCount.js';

/**
 * Callback to look up a sanitized answer code given a question name and original choice value.
 * Returns the sanitized code, or the original value unchanged if no mapping exists.
 */
export type AnswerCodeLookup = (
  sanitizedQuestionName: string,
  originalChoiceValue: string,
) => string;

/**
 * Context for transpilation that provides answer code lookup and type-aware expression building.
 */
export interface TranspilerContext {
  /** Rewrite a choice value to its sanitized answer code for equality comparisons */
  lookupAnswerCode?: AnswerCodeLookup;
  /** Build a complete selected() expression, handling select_one vs select_multiple */
  buildSelectedExpr?: (
    sanitizedFieldName: string,
    originalChoiceValue: string,
  ) => string;
  /** Get the truncated field name (sanitized and truncated to 20 chars) */
  getTruncatedFieldName?: (fieldName: string) => string;
  /**
   * The LimeSurvey fields holding a select_multiple's ticks (`q_a`, `q_b`,
   * …, plus `q_other` for a native other), given its normalized name, or
   * `null` when the name is no select_multiple. What `count-selected()`
   * counts (convention:logicMapping `selectionCount`).
   */
  selectionFields?: (fieldName: string) => string[] | null;
  /** The name `.` stands for (a constraint's own question). */
  selfName?: string;
  /**
   * `${name}` (as authored) → the name every other hook receives. Without
   * it, a reference is normalized (convention:sanitization) and the hooks
   * resolve that, which can't tell apart two names that strip alike.
   */
  resolveReference?: (name: string) => string;
}

function isVariableRef(
  node: XPathNode,
): node is { kind: 'path'; name: string } {
  return node.kind === 'path' && node.name !== null;
}

/**
 * A path's field name as the hooks want it: already resolved when the
 * context resolves references, else normalized.
 */
function refName(name: string, ctx: TranspilerContext | undefined): string {
  return ctx?.resolveReference ? name : sanitizeName(name);
}

function sanitizeName(name: string): string {
  return normalizeName(name);
}

/** How tightly a node binds when it appears as an operand. */
function precedenceOf(node: XPathNode): number {
  if (node.kind === 'bin') return PRECEDENCE[node.op];
  if (node.kind === 'neg') return UNARY_PRECEDENCE;
  return Infinity; // literals, paths, calls
}

/** Ops where `a op (b op c)` equals `(a op b) op c`, so no right-side parens. */
const ASSOCIATIVE = new Set<BinaryOp>(['+', '*', 'and', 'or']);

/**
 * Transpile `node` as an operand of an operator with precedence `parentPrec`,
 * parenthesised when EM would otherwise regroup it.
 */
function operand(
  node: XPathNode,
  parentPrec: number,
  ctx: TranspilerContext | undefined,
  rightOf?: BinaryOp,
): string {
  const text = transpile(node, ctx);
  const prec = precedenceOf(node);
  const needsParens =
    prec < parentPrec ||
    (rightOf !== undefined && prec === parentPrec && !ASSOCIATIVE.has(rightOf));
  return needsParens ? `(${text})` : text;
}

function joinArgs(args: XPathNode[], ctx?: TranspilerContext): string {
  return args.map((a) => transpile(a, ctx)).join(', ');
}

function wrapArgs(
  prefix: string,
  args: XPathNode[],
  ctx?: TranspilerContext,
): string {
  return `${prefix}(${joinArgs(args, ctx)})`;
}

function arg(args: XPathNode[], i: number, fn: string): XPathNode {
  const node = args[i];
  if (!node)
    throw new ConversionError(
      'xpath-syntax',
      `${fn}() needs at least ${i + 1} argument(s)`,
    );
  return node;
}

const FUNCTION_HANDLERS: Record<
  string,
  (args: XPathNode[], ctx?: TranspilerContext) => string
> = {
  // 0-arg
  today: () => 'today()',
  now: () => 'now()',
  true: () => '1',
  false: () => '0',
  // 1-arg pass-through
  string: (args, ctx) => transpile(arg(args, 0, 'string'), ctx),
  number: (args, ctx) => transpile(arg(args, 0, 'number'), ctx),
  not: (args, ctx) => `!(${transpile(arg(args, 0, 'not'), ctx)})`,
  // 1-arg with rename
  floor: (args, ctx) => wrapArgs('floor', args, ctx),
  ceiling: (args, ctx) => wrapArgs('ceil', args, ctx),
  round: (args, ctx) => wrapArgs('round', args, ctx),
  sum: (args, ctx) => wrapArgs('sum', args, ctx),
  'string-length': (args, ctx) => wrapArgs('strlen', args, ctx),
  'normalize-space': (args, ctx) => wrapArgs('trim', args, ctx),
  // variadic
  count: (args, ctx) => wrapArgs('count', args, ctx),
  // EM's `+` is also string concatenation, so any operator argument gets its
  // own parentheses: `a + b - c` would join strings, then subtract.
  concat: (args, ctx) => args.map((a) => operand(a, Infinity, ctx)).join(' + '),
  regex: (args, ctx) => wrapArgs('regexMatch', args, ctx),
  // 2-arg
  contains: (args, ctx) =>
    `contains(${transpile(arg(args, 0, 'contains'), ctx)}, ${transpile(arg(args, 1, 'contains'), ctx)})`,
  'starts-with': (args, ctx) =>
    `startsWith(${transpile(arg(args, 0, 'starts-with'), ctx)}, ${transpile(arg(args, 1, 'starts-with'), ctx)})`,
  'ends-with': (args, ctx) =>
    `endsWith(${transpile(arg(args, 0, 'ends-with'), ctx)}, ${transpile(arg(args, 1, 'ends-with'), ctx)})`,
};

/** XPath operator → EM operator. */
const EM_OPS: Record<BinaryOp, string> = {
  or: 'or',
  and: 'and',
  '=': '==',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '+': '+',
  '-': '-',
  '*': '*',
  div: '/',
  mod: '%',
};

function rewriteWithAnswerLookup(
  leftNode: XPathNode,
  rightNode: XPathNode,
  ctx: TranspilerContext | undefined,
  op: string,
): string | null {
  if (!ctx?.lookupAnswerCode) return null;
  if (!isVariableRef(leftNode) || rightNode.kind !== 'str') return null;
  const fieldName = refName(leftNode.name, ctx);
  const rawValue = rightNode.value;
  const rewritten = ctx.lookupAnswerCode(fieldName, rawValue);
  if (rewritten === rawValue) return null;
  const truncated = ctx.getTruncatedFieldName
    ? ctx.getTruncatedFieldName(fieldName)
    : fieldName;
  return `${truncated} ${op} '${rewritten}'`;
}

function transpileSelected(args: XPathNode[], ctx?: TranspilerContext): string {
  if (args.length !== 2)
    throw new ConversionError('xpath-syntax', 'selected() needs 2 arguments');
  const fieldName = transpile(args[0], ctx);
  const value = transpile(args[1], ctx).replace(/^['"]|['"]$/g, '');
  const sanitizedField = refName(fieldName, ctx);
  if (ctx?.buildSelectedExpr) {
    return ctx.buildSelectedExpr(sanitizedField, value);
  }
  return `(${sanitizedField}=="${value}")`;
}

/**
 * `count-selected(${q})` → `count(q_a.NAOK, q_b.NAOK, …)`. An unticked
 * subquestion is empty, so `count()` counts the ticked ones.
 */
function transpileCountSelected(
  args: XPathNode[],
  ctx?: TranspilerContext,
): string {
  const target = arg(args, 0, COUNT_SELECTED);
  if (target.kind !== 'path') {
    throw new ConversionError(
      'xpath-unsupported',
      `${COUNT_SELECTED}() needs a question reference`,
    );
  }
  const name = target.name === null ? ctx?.selfName : refName(target.name, ctx);
  const fields = name ? ctx?.selectionFields?.(name) : null;
  if (!fields || fields.length === 0) {
    throw new ConversionError(
      'xpath-unsupported',
      `${COUNT_SELECTED}() needs a select_multiple question, got ${target.name === null ? "'.'" : `'${target.name}'`}`,
    );
  }
  return `count(${fields.map((f) => `${f}.NAOK`).join(', ')})`;
}

function transpileSubstring(
  args: XPathNode[],
  ctx?: TranspilerContext,
): string {
  if (args.length < 2)
    throw new ConversionError('xpath-syntax', 'substring() needs ≥2 arguments');
  const stringArg = transpile(args[0], ctx);
  const startArg = transpile(args[1], ctx);
  const lengthArg = args.length > 2 ? transpile(args[2], ctx) : '';
  return `substr(${stringArg}, ${startArg}${lengthArg ? ', ' + lengthArg : ''})`;
}

function transpileFunctionCall(
  node: { name: string; args: XPathNode[] },
  ctx?: TranspilerContext,
): string {
  const { name, args } = node;
  if (name === 'selected') return transpileSelected(args, ctx);
  if (name === 'substring') return transpileSubstring(args, ctx);
  if (name === COUNT_SELECTED) return transpileCountSelected(args, ctx);
  const handler = FUNCTION_HANDLERS[name];
  if (handler) return handler(args, ctx);
  if (name === 'if' && args.length === 3) {
    return `if(${transpile(args[0], ctx)}, ${transpile(args[1], ctx)}, ${transpile(args[2], ctx)})`;
  }
  throw new ConversionError(
    'xpath-unsupported',
    `Unsupported function: ${name}()`,
  );
}

function transpileBinaryOp(
  node: { op: BinaryOp; left: XPathNode; right: XPathNode },
  ctx?: TranspilerContext,
): string {
  const { op, left, right } = node;
  const emOp = EM_OPS[op];
  if (op === '=' || op === '!=') {
    const rewritten = rewriteWithAnswerLookup(left, right, ctx, emOp);
    if (rewritten) return rewritten;
  }
  const prec = PRECEDENCE[op];
  return `${operand(left, prec, ctx)} ${emOp} ${operand(right, prec, ctx, op)}`;
}

function transpileVariableRef(
  name: string | null,
  ctx?: TranspilerContext,
): string {
  if (name === null) return 'self';
  const fieldName = refName(name, ctx);
  return ctx?.getTruncatedFieldName
    ? ctx.getTruncatedFieldName(fieldName)
    : fieldName;
}

function transpile(node: XPathNode, ctx?: TranspilerContext): string {
  switch (node.kind) {
    case 'num':
      return node.text;
    case 'str':
      return `${node.delim}${node.value}${node.delim}`;
    case 'path':
      return transpileVariableRef(node.name, ctx);
    case 'call':
      return transpileFunctionCall(node, ctx);
    case 'bin':
      return transpileBinaryOp(node, ctx);
    case 'neg':
      return `-${operand(node.operand, UNARY_PRECEDENCE, ctx)}`;
  }
}

function preprocessExpression(expr: string, ctx?: TranspilerContext): string {
  const resolve = ctx?.resolveReference ?? sanitizeName;
  return expr.replace(/\$\{([^}]+)\}/g, (_m, name: string) =>
    resolve(name.trim()),
  );
}

/**
 * Convert XPath expression to LimeSurvey Expression Manager syntax.
 *
 * @param xpathExpr - The XPath expression to convert
 * @returns LimeSurvey Expression Manager syntax; `'1'` for an empty expression
 * @throws when the expression can't be parsed or uses an unsupported function —
 *   never silently degrades to `'1'`, which would drop skip logic
 */
export function xpathToLimeSurvey(
  xpathExpr: string,
  ctx?: TranspilerContext,
): Promise<string> {
  // Promise-returning public API; the converter uses the sync core.
  try {
    return Promise.resolve(xpathToLimeSurveySync(xpathExpr, ctx));
  } catch (error: unknown) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/** Synchronous core of {@link xpathToLimeSurvey}; throws on failure. */
export function xpathToLimeSurveySync(
  xpathExpr: string,
  ctx?: TranspilerContext,
): string {
  if (!xpathExpr || xpathExpr.trim() === '') return '1'; // default relevance
  const processedExpr = preprocessExpression(xpathExpr, ctx);
  try {
    return transpile(parseXPath(processedExpr), ctx);
  } catch (error: unknown) {
    throw new ConversionError(
      error instanceof ConversionError ? error.code : 'xpath-syntax',
      `Cannot convert XPath expression "${xpathExpr}" to LimeSurvey: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

/** Logic-operators signature used to tell logical expressions apart from a real
 * regex pattern (which contains `[...]` character classes). */
const LOGICAL_OPERATORS = ['>=', '<=', '>', '<', '=', '!=', 'and', 'or'];

/** First-arg-looks-like-a-pattern-not-an-expression predicate. */
function firstArgLooksLogical(firstArg: string): boolean {
  return LOGICAL_OPERATORS.some(
    (op) =>
      firstArg.includes(op) &&
      !(firstArg.includes('[') && firstArg.includes(']')),
  );
}

/** Second-arg-is-a-field-ref predicate (`.` or `\w+`). */
function secondArgIsFieldRef(secondArg: string): boolean {
  return secondArg === '.' || /^\w+$/.test(secondArg);
}

/** First-arg-is-a-regex-pattern predicate (anchor or character class). */
function firstArgLooksLikePattern(firstArg: string): boolean {
  return (
    firstArg.includes('^') ||
    firstArg.includes('$') ||
    (firstArg.includes('[') && firstArg.includes(']'))
  );
}

/** Apply the `regexMatch(<pattern>, <field>)` reconstruction rule to two parsed args. */
function reconstructRegexMatch(
  firstArg: string,
  secondArg: string,
): string | null {
  if (firstArgLooksLogical(firstArg)) return firstArg.replace(/^"|"$/g, '');
  if (!secondArgIsFieldRef(secondArg) || !firstArgLooksLikePattern(firstArg))
    return null;
  const processedFieldArg = secondArg.replace(/\./g, 'self');
  const processedPatternArg = firstArg
    .replace(/^"|"$/g, "'")
    .replace(/\\'/g, "'");
  return `regexMatch(${processedPatternArg}, ${processedFieldArg})`;
}

/**
 * Convert XPath constraint to LimeSurvey validation pattern
 *
 * @param constraint - The XPath constraint expression
 * @returns Validation pattern (regex or EM equation)
 */
export function convertConstraint(
  constraint: string,
  onWarning: WarningHandler = consoleWarning,
): Promise<string> {
  return Promise.resolve(convertConstraintSync(constraint, onWarning));
}

/** Synchronous core of {@link convertConstraint}. */
export function convertConstraintSync(
  constraint: string,
  onWarning: WarningHandler = consoleWarning,
  ctx?: TranspilerContext,
): string {
  if (!constraint) return '';

  const processedExpr = preprocessExpression(constraint, ctx);

  // Special handling for regexMatch function — only invoked when the source
  // expression actually contains a top-level regexMatch(...).
  const regexMatchMatch = processedExpr.match(/regexMatch\(\s*([^)]+)\s*\)/);
  if (regexMatchMatch) {
    const args = parseRegexMatchArguments(regexMatchMatch[1]);
    if (args.length >= 2) {
      const result = reconstructRegexMatch(args[0], args[1]);
      if (result) return result;
    }
  }

  try {
    return transpile(parseXPath(processedExpr), ctx);
  } catch (error: unknown) {
    return dropConstraint(constraint, error, onWarning);
  }
}

/**
 * Documented fallback: a constraint that isn't XPath (e.g. a bare regex) is
 * dropped rather than failing the conversion — the form then accepts more
 * input, it never hides questions.
 */
function dropConstraint(
  constraint: string,
  error: unknown,
  onWarning: WarningHandler,
): string {
  onWarning(
    warning(
      'constraint-dropped',
      `Constraint "${constraint}" can't be converted and is dropped (the question accepts any answer): ${(error as Error).message}`,
    ),
  );
  return '';
}

/** A select_multiple's constraint: bounds on its answer count + the rest. */
export interface SelectionConstraint {
  /** The validation equation for whatever isn't a bound ('' for none). */
  validation: string;
  /** Lower bound on the number of ticked answers (`min_answers`). */
  min?: number;
  /** Upper bound on the number of ticked answers (`max_answers`). */
  max?: number;
}

/** The terms of a top-level `a and b and c`. */
function conjuncts(node: XPathNode): XPathNode[] {
  return node.kind === 'bin' && node.op === 'and'
    ? [...conjuncts(node.left), ...conjuncts(node.right)]
    : [node];
}

/** `x op n` read from the count's side: `3 >= count-selected(.)` is `<= 3`. */
const MIRROR: Partial<Record<BinaryOp, BinaryOp>> = {
  '<': '>',
  '<=': '>=',
  '>': '<',
  '>=': '<=',
  '=': '=',
};

/**
 * The bound one constraint term puts on the question's own answer count, or
 * null when the term is anything else (it then stays in the equation).
 */
function selectionBound(
  node: XPathNode,
  ctx: TranspilerContext | undefined,
): { min?: number; max?: number } | null {
  const selfName = ctx?.selfName;
  if (node.kind !== 'bin' || !(node.op in MIRROR)) return null;
  const isSelfCount = (n: XPathNode) =>
    n.kind === 'call' &&
    n.name === COUNT_SELECTED &&
    n.args.length === 1 &&
    n.args[0].kind === 'path' &&
    (n.args[0].name === null ||
      (selfName !== undefined && refName(n.args[0].name, ctx) === selfName));
  let op: BinaryOp;
  let numNode: XPathNode;
  if (isSelfCount(node.left)) {
    op = node.op;
    numNode = node.right;
  } else if (isSelfCount(node.right)) {
    op = MIRROR[node.op]!;
    numNode = node.left;
  } else return null;
  if (numNode.kind !== 'num') return null;
  const n = Number(numNode.text);
  if (!Number.isFinite(n)) return null;
  switch (op) {
    case '<=':
      return { max: Math.floor(n) };
    case '<':
      return { max: Math.ceil(n) - 1 };
    case '>=':
      return { min: Math.ceil(n) };
    case '>':
      return { min: Math.floor(n) + 1 };
    default:
      return Number.isInteger(n) ? { min: n, max: n } : null;
  }
}

/**
 * A select_multiple's constraint (convention:logicMapping `selectionCount`):
 * each top-level `and` term comparing `count-selected(.)` with a number
 * becomes a bound for LimeSurvey's `min_answers` / `max_answers`; the other
 * terms stay the validation equation, where a `count-selected()` becomes
 * `count()` over the subquestions.
 */
export function convertSelectionConstraintSync(
  constraint: string,
  onWarning: WarningHandler = consoleWarning,
  ctx?: TranspilerContext,
): SelectionConstraint {
  if (!constraint) return { validation: '' };
  let terms: XPathNode[];
  try {
    terms = conjuncts(parseXPath(preprocessExpression(constraint, ctx)));
  } catch {
    return { validation: convertConstraintSync(constraint, onWarning, ctx) };
  }
  const out: SelectionConstraint = { validation: '' };
  const rest: XPathNode[] = [];
  for (const term of terms) {
    const bound = selectionBound(term, ctx);
    if (!bound) {
      rest.push(term);
      continue;
    }
    if (bound.min !== undefined) out.min = Math.max(out.min ?? 0, bound.min);
    if (bound.max !== undefined)
      out.max = Math.min(out.max ?? Infinity, bound.max);
  }
  if (rest.length === 0) return out;
  if (rest.length === terms.length) {
    out.validation = convertConstraintSync(constraint, onWarning, ctx);
    return out;
  }
  const remaining = rest.reduce((left, right): XPathNode => ({
    kind: 'bin',
    op: 'and',
    left,
    right,
  }));
  try {
    out.validation = transpile(remaining, ctx);
  } catch (error: unknown) {
    out.validation = dropConstraint(constraint, error, onWarning);
  }
  return out;
}

/** Char state inside {@link parseRegexMatchArguments}'s one-pass scanner. */
interface RegexArgState {
  inQuotes: boolean;
  quoteChar: string;
  parenDepth: number;
}

/** Process a single char into the accumulator + new state; return the (possibly
 * completed) argument when a top-level comma is reached. */
function stepRegexChar(
  char: string,
  prev: string,
  state: RegexArgState,
  current: string,
): { current: string; state: RegexArgState; flushedArg: string | null } {
  const isStringDelimiter = (c: string) => c === '"' || c === "'";
  const isUnescapedDelimiter = isStringDelimiter(char) && prev !== '\\';

  if (isUnescapedDelimiter) {
    const next: RegexArgState = { ...state };
    if (!state.inQuotes) {
      next.inQuotes = true;
      next.quoteChar = char;
    } else if (char === state.quoteChar) {
      next.inQuotes = false;
    }
    return { current: current + char, state: next, flushedArg: null };
  }

  if (char === '(' && !state.inQuotes) {
    return {
      current: current + char,
      state: { ...state, parenDepth: state.parenDepth + 1 },
      flushedArg: null,
    };
  }
  if (char === ')' && !state.inQuotes) {
    return {
      current: current + char,
      state: { ...state, parenDepth: state.parenDepth - 1 },
      flushedArg: null,
    };
  }
  if (char === ',' && !state.inQuotes && state.parenDepth === 0) {
    return {
      current: '',
      state,
      flushedArg: current.trim(),
    };
  }

  return { current: current + char, state, flushedArg: null };
}

/**
 * Parse arguments from a regexMatch function call. Walks once through the source,
 * splitting on top-level commas while respecting quotes and parenthesis depth —
 * returns the args with their surrounding quotes intact.
 */
function parseRegexMatchArguments(argsString: string): string[] {
  const args: string[] = [];
  let current = '';
  let state: RegexArgState = { inQuotes: false, quoteChar: '', parenDepth: 0 };

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    const prev = i > 0 ? argsString[i - 1] : '';
    const step = stepRegexChar(char, prev, state, current);
    current = step.current;
    state = step.state;
    if (step.flushedArg !== null) {
      args.push(step.flushedArg);
    }
  }

  const trimmed = current.trim();
  if (trimmed) args.push(trimmed);
  return args;
}

/**
 * Convert XPath relevance expression to LimeSurvey Expression Manager syntax
 *
 * @param xpath - The XPath relevance expression
 * @returns LimeSurvey Expression Manager syntax
 */
export function convertRelevance(
  xpathExpr: string,
  ctx?: TranspilerContext,
): Promise<string> {
  try {
    return Promise.resolve(convertRelevanceSync(xpathExpr, ctx));
  } catch (error: unknown) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/** Synchronous core of {@link convertRelevance}. */
export function convertRelevanceSync(
  xpathExpr: string,
  ctx?: TranspilerContext,
): string {
  if (!xpathExpr) return '1';

  // XPath operators are lowercase; accept AND/OR as XLSForm authors write them
  const normalizedXPath = xpathExpr
    .replace(/\bAND\b/gi, 'and')
    .replace(/\bOR\b/gi, 'or');

  const result = xpathToLimeSurveySync(normalizedXPath, ctx);

  // Handle edge case: selected() with just {field} (without $)
  if (result && typeof result === 'string' && result.includes('selected(')) {
    return result.replace(
      /selected\s*\(\s*\{(\w+)\}\s*,\s*["']([^'"]+)["']\s*\)/g,
      (_match, fieldName: string, value: string) =>
        `(${sanitizeName(fieldName)}="${value}")`,
    );
  }

  return result || '1';
}
