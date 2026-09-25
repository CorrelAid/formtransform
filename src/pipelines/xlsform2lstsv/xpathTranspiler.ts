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
} from './xpathParser.js';

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
}

function isVariableRef(
  node: XPathNode,
): node is { kind: 'path'; name: string } {
  return node.kind === 'path' && node.name !== null;
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
  if (!node) throw new Error(`${fn}() needs at least ${i + 1} argument(s)`);
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
  const fieldName = sanitizeName(leftNode.name);
  const rawValue = rightNode.value;
  const rewritten = ctx.lookupAnswerCode(fieldName, rawValue);
  if (rewritten === rawValue) return null;
  const truncated = ctx.getTruncatedFieldName
    ? ctx.getTruncatedFieldName(fieldName)
    : fieldName;
  return `${truncated} ${op} '${rewritten}'`;
}

function transpileSelected(args: XPathNode[], ctx?: TranspilerContext): string {
  if (args.length !== 2) throw new Error('selected() needs 2 arguments');
  const fieldName = transpile(args[0], ctx);
  const value = transpile(args[1], ctx).replace(/^['"]|['"]$/g, '');
  const sanitizedField = sanitizeName(fieldName);
  if (ctx?.buildSelectedExpr) {
    return ctx.buildSelectedExpr(sanitizedField, value);
  }
  return `(${sanitizedField}=="${value}")`;
}

function transpileSubstring(
  args: XPathNode[],
  ctx?: TranspilerContext,
): string {
  if (args.length < 2) throw new Error('substring() needs ≥2 arguments');
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
  const handler = FUNCTION_HANDLERS[name];
  if (handler) return handler(args, ctx);
  if (name === 'if' && args.length === 3) {
    return `if(${transpile(args[0], ctx)}, ${transpile(args[1], ctx)}, ${transpile(args[2], ctx)})`;
  }
  throw new Error(`Unsupported function: ${name}()`);
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
  const fieldName = sanitizeName(name);
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

function preprocessExpression(expr: string): string {
  return expr
    .replace(/\$\{([^}]+)\}/g, (_m, name: string) => sanitizeName(name))
    .replace(
      /selected\(\s*\$\{([^}]+)\}\s*,\s*['"]([^'"]+)['"]\s*\)/g,
      (_m, name: string, value: string) =>
        `selected(${sanitizeName(name)}, '${value}')`,
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
  // Stays Promise-returning: it's public API, and callers await it.
  if (!xpathExpr || xpathExpr.trim() === '') {
    return Promise.resolve('1'); // Default relevance expression
  }
  const processedExpr = preprocessExpression(xpathExpr);
  try {
    return Promise.resolve(transpile(parseXPath(processedExpr), ctx));
  } catch (error: unknown) {
    const wrapped = new Error(
      `Cannot convert XPath expression "${xpathExpr}" to LimeSurvey: ${(error as Error).message}`,
    );
    (wrapped as Error & { cause?: unknown }).cause = error;
    return Promise.reject(wrapped);
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
export function convertConstraint(constraint: string): Promise<string> {
  return Promise.resolve(convertConstraintSync(constraint));
}

function convertConstraintSync(constraint: string): string {
  if (!constraint) return '';

  const processedExpr = preprocessExpression(constraint);

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
    return transpile(parseXPath(processedExpr));
  } catch (error: unknown) {
    // Documented fallback: a constraint that isn't XPath (e.g. a bare regex)
    // is dropped rather than failing the conversion — the form then accepts
    // more input, it never hides questions.
    console.error(`Constraint conversion error: ${(error as Error).message}`);
    return '';
  }
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
export async function convertRelevance(
  xpathExpr: string,
  ctx?: TranspilerContext,
): Promise<string> {
  if (!xpathExpr) return '1';

  // XPath operators are lowercase; accept AND/OR as XLSForm authors write them
  const normalizedXPath = xpathExpr
    .replace(/\bAND\b/gi, 'and')
    .replace(/\bOR\b/gi, 'or');

  const result = await xpathToLimeSurvey(normalizedXPath, ctx);

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
