/**
 * XPath to LimeSurvey Expression Transpiler
 *
 * This module provides functions to transpile XPath expressions from XLSForm
 * to LimeSurvey Expression Manager syntax using AST-based transformation.
 *
 * The transpiler uses js-xpath library to parse XPath expressions into AST,
 * then recursively transforms the AST nodes to LimeSurvey-compatible syntax.
 */

interface XPathNode {
  id?: string;
  type?: string;
  args?: unknown[];
  left?: unknown;
  right?: unknown;
  steps?: Array<{
    name?: string;
    axis?: string;
  }>;
  value?:
    | {
        _?: string;
      }
    | string;
  valueDisplay?: string;
  stringDelim?: string;
}

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

function isVariableRef(node: XPathNode): boolean {
  return !!(node.steps && node.steps.length > 0 && node.steps[0].name);
}

function isStringLiteral(node: XPathNode): boolean {
  return typeof node.value === 'string';
}

/**
 * Sanitize field names by removing underscores and hyphens to match LimeSurvey's naming conventions
 */
function sanitizeName(name: string): string {
  return name.replace(/[_-]/g, '');
}

/** All positional args joined with `, ` (XPath variadic → EM list). */
function joinArgs(args: unknown[] | undefined, ctx?: TranspilerContext): string {
  return (args ?? [])
    .map((a) => transpile(a as XPathNode, ctx))
    .join(', ');
}

/** Pass-through: every arg becomes `prefix(argN)`. */
function wrapArgs(
  prefix: string,
  args: unknown[] | undefined,
  ctx?: TranspilerContext,
): string {
  return `${prefix}(${joinArgs(args, ctx)})`;
}

const FUNCTION_HANDLERS: Record<
  string,
  (args: unknown[] | undefined, ctx?: TranspilerContext) => string
> = {
  // 0-arg
  today: () => 'today()',
  now: () => 'now()',
  // 1-arg pass-through
  string: (args, ctx) => transpile(args![0] as XPathNode, ctx),
  number: (args, ctx) => transpile(args![0] as XPathNode, ctx),
  not: (args, ctx) => `!(${transpile(args![0] as XPathNode, ctx)})`,
  // 1-arg with rename
  floor: (args, ctx) => wrapArgs('floor', args, ctx),
  ceiling: (args, ctx) => wrapArgs('ceil', args, ctx),
  round: (args, ctx) => wrapArgs('round', args, ctx),
  sum: (args, ctx) => wrapArgs('sum', args, ctx),
  'string-length': (args, ctx) => wrapArgs('strlen', args, ctx),
  'normalize-space': (args, ctx) => wrapArgs('trim', args, ctx),
  // variadic
  count: (args, ctx) => wrapArgs('count', args, ctx),
  concat: (args, ctx) =>
    (args ?? [])
      .map((a) => transpile(a as XPathNode, ctx))
      .join(' + ') || '',
  regex: (args, ctx) => wrapArgs('regexMatch', args, ctx),
  // 2-arg
  contains: (args, ctx) =>
    `contains(${transpile(args![0] as XPathNode, ctx)}, ${transpile(args![1] as XPathNode, ctx)})`,
  'starts-with': (args, ctx) =>
    `startsWith(${transpile(args![0] as XPathNode, ctx)}, ${transpile(args![1] as XPathNode, ctx)})`,
  'ends-with': (args, ctx) =>
    `endsWith(${transpile(args![0] as XPathNode, ctx)}, ${transpile(args![1] as XPathNode, ctx)})`,
};

const SIMPLE_BINARY_OPS: Record<string, string> = {
  '<=': ' <= ',
  '>=': ' >= ',
  '<': ' < ',
  '>': ' > ',
  '+': ' + ',
  '-': ' - ',
  '*': ' * ',
  div: ' / ',
  mod: ' % ',
  and: ' and ',
  or: ' or ',
};

/** Equal-comparison helper: when a var-ref `==` (or `!=`) hits a string literal whose
 * value can be remapped to a sanitized answer code, emit `field == '<remapped>'`
 * (truncating the field name) instead of recursing on both sides. */
function rewriteWithAnswerLookup(
  leftNode: XPathNode,
  rightNode: XPathNode,
  ctx: TranspilerContext | undefined,
  op: string,
): string | null {
  if (!ctx?.lookupAnswerCode) return null;
  if (!isVariableRef(leftNode) || !isStringLiteral(rightNode)) return null;
  const fieldName = sanitizeName(leftNode.steps![0].name!);
  const rawValue = rightNode.value as string;
  const rewritten = ctx.lookupAnswerCode(fieldName, rawValue);
  if (rewritten === rawValue) return null;
  const truncated = ctx.getTruncatedFieldName
    ? ctx.getTruncatedFieldName(fieldName)
    : fieldName;
  return `${truncated} ${op} '${rewritten}'`;
}

/** String-valued function calls that need custom logic beyond a single Map entry. */
function transpileSelected(args: unknown[] | undefined, ctx?: TranspilerContext): string {
  if (args?.length !== 2) throw new Error('selected() needs 2 arguments');
  const fieldArg = args[0] as XPathNode;
  const valueArg = args[1] as XPathNode;
  const fieldName = transpile(fieldArg, ctx);
  let value = transpile(valueArg, ctx);
  value = value.replace(/^['"]|['"]$/g, '');
  const sanitizedField = sanitizeName(fieldName);
  if (ctx?.buildSelectedExpr) {
    return ctx.buildSelectedExpr(sanitizedField, value);
  }
  return `(${sanitizedField}=="${value}")`;
}

function transpileSubstring(
  args: unknown[] | undefined,
  ctx?: TranspilerContext,
): string {
  if (!args || args.length < 2) throw new Error('substring() needs ≥2 arguments');
  const stringArg = transpile(args[0] as XPathNode, ctx);
  const startArg = transpile(args[1] as XPathNode, ctx);
  const lengthArg =
    args.length > 2 ? transpile(args[2] as XPathNode, ctx) : '';
  return `substr(${stringArg}, ${startArg}${lengthArg ? ', ' + lengthArg : ''})`;
}

/** `selected(${field}, 'value')` and `substring(...)` need custom logic; dispatch
 * any other known function via the static table. */
function transpileFunctionCall(node: XPathNode, ctx?: TranspilerContext): string {
  const id = node.id!;
  const args = node.args;
  if (id === 'selected') return transpileSelected(args, ctx);
  if (id === 'substring') return transpileSubstring(args, ctx);
  const handler = FUNCTION_HANDLERS[id];
  if (handler) return handler(args, ctx);
  if (id === 'if') {
    if (args?.length === 3) {
      return `if(${transpile(args[0] as XPathNode, ctx)}, ${transpile(args[1] as XPathNode, ctx)}, ${transpile(args[2] as XPathNode, ctx)})`;
    }
  }
  throw new Error(`Unsupported function: ${id}`);
}

/** Equality (`=` / `==`) — special-cases the answer-code lookup, otherwise recurses. */
function transpileEquality(node: XPathNode, ctx?: TranspilerContext): string {
  const leftNode = node.left as XPathNode;
  const rightNode = node.right as XPathNode;
  const rewritten = rewriteWithAnswerLookup(leftNode, rightNode, ctx, '==');
  if (rewritten) return rewritten;
  return `${transpile(leftNode, ctx)} == ${transpile(rightNode, ctx)}`;
}

/** Inequality (`!=`) — same lookup pattern as equality but with the inverted operator. */
function transpileInequality(node: XPathNode, ctx?: TranspilerContext): string {
  const leftNode = node.left as XPathNode;
  const rightNode = node.right as XPathNode;
  const rewritten = rewriteWithAnswerLookup(leftNode, rightNode, ctx, '!=');
  if (rewritten) return rewritten;
  return `${transpile(leftNode, ctx)} != ${transpile(rightNode, ctx)}`;
}

/** Plain `${left} <op> ${right}` for operators that don't need special handling. */
function transpileSimpleBinaryOp(
  node: XPathNode,
  ctx: TranspilerContext | undefined,
): string {
  const op = SIMPLE_BINARY_OPS[node.type!];
  if (!op) {
    throw new Error(`Unsupported XPath operator: ${node.type}`);
  }
  return `${transpile(node.left as XPathNode, ctx)}${op}${transpile(node.right as XPathNode, ctx)}`;
}

function transpileBinaryOp(node: XPathNode, ctx?: TranspilerContext): string {
  switch (node.type) {
    case '=':
    case '==':
      return transpileEquality(node, ctx);
    case '!=':
      return transpileInequality(node, ctx);
    default:
      return transpileSimpleBinaryOp(node, ctx);
  }
}

/** Variable references become the sanitized, possibly truncated field name. */
function transpileVariableRef(node: XPathNode, ctx?: TranspilerContext): string {
  const step = node.steps![0];
  if (!step.name) return 'self';
  const fieldName = sanitizeName(step.name);
  return ctx?.getTruncatedFieldName ? ctx.getTruncatedFieldName(fieldName) : fieldName;
}

/** Literal (string / numeric) values. `valueDisplay` carries the original quoted form. */
function transpileLiteral(node: XPathNode): string {
  if (typeof node.value === 'object' && node.value !== null) {
    return node.value._ ?? '';
  }
  if (typeof node.value === 'string') {
    return node.valueDisplay ?? node.value;
  }
  return '';
}

/**
 * Transpiles jsxpath AST nodes to LimeSurvey expression syntax
 *
 * This function takes the Abstract Syntax Tree (AST) nodes produced by the jsxpath library
 * and converts them to LimeSurvey-compatible expression syntax. The jsxpath library
 * returns different node structures depending on the type of XPath expression:
 *
 * - Function calls: Objects with 'id' property (e.g., count(), concat(), regex())
 * - Binary operations: Objects with 'type' property (e.g., <=, >=, =, and, or)
 * - Variable references: Objects with 'steps' arrays containing axis/name info
 * - Literal values: Objects with 'value' property containing the actual value
 *
 * The function recursively processes the AST, handling each node type appropriately
 * and converting XPath syntax to LimeSurvey Expression Manager syntax.
 *
 * @param node - The AST node from jsxpath.parse()
 * @returns The transpiled LimeSurvey expression string
 * @throws Error if an unsupported node structure is encountered
 */
function transpile(node: XPathNode, ctx?: TranspilerContext): string {
  if (!node) return '';
  if (node.id) return transpileFunctionCall(node, ctx);
  if (node.type) return transpileBinaryOp(node, ctx);
  if (node.steps && node.steps.length > 0) return transpileVariableRef(node, ctx);
  if (node.value !== undefined) return transpileLiteral(node);
  throw new Error(`Unsupported node structure: ${JSON.stringify(node)}`);
}

/** Preprocess XLSForm `${field}` / `selected(${field}, 'v')` template syntax to bare XPath. */
function preprocessExpression(expr: string): string {
  return expr
    .replace(/\$\{([^}]+)\}/g, (_m, name: string) => sanitizeName(name))
    .replace(
      /selected\(\s*\$\{([^}]+)\}\s*,\s*['"]([^'"]+)['"]\s*\)/g,
      (_m, name: string, value: string) =>
        `selected(${sanitizeName(name)}, '${value}')`,
    );
}

async function loadJxpath(): Promise<{
  parse: (expr: string) => XPathNode;
}> {
  const jxpathModule = await import('js-xpath');
  const jxpath = jxpathModule.default || jxpathModule;
  if (!jxpath || !jxpath.parse) {
    throw new Error('js-xpath module does not export parse function');
  }
  return jxpath;
}

/**
 * Convert XPath expression to LimeSurvey Expression Manager syntax
 *
 * @param xpathExpr - The XPath expression to convert
 * @returns LimeSurvey Expression Manager syntax, or null if conversion fails
 */
export async function xpathToLimeSurvey(
  xpathExpr: string,
  ctx?: TranspilerContext,
): Promise<string> {
  if (!xpathExpr || xpathExpr.trim() === '') {
    return '1'; // Default relevance expression
  }

  const processedExpr = preprocessExpression(xpathExpr);

  try {
    const jxpath = await loadJxpath();
    return transpile(jxpath.parse(processedExpr), ctx);
  } catch (error: unknown) {
    console.error(`Transpilation error: ${(error as Error).message}`);
    return '1';
  }
}

/** Logic-operators signature used to tell logical expressions apart from a real
 * regex pattern (which contains `[...]` character classes). */
const LOGICAL_OPERATORS = ['>=', '<=', '>', '<', '=', '!=', 'and', 'or'];

/** First-arg-looks-like-a-pattern-not-an-expression predicate. */
function firstArgLooksLogical(firstArg: string): boolean {
  return LOGICAL_OPERATORS.some(
    (op) =>
      firstArg.includes(op) && !(firstArg.includes('[') && firstArg.includes(']')),
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
function reconstructRegexMatch(firstArg: string, secondArg: string): string | null {
  if (firstArgLooksLogical(firstArg)) return firstArg.replace(/^"|"$/g, '');
  if (!secondArgIsFieldRef(secondArg) || !firstArgLooksLikePattern(firstArg)) return null;
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
export async function convertConstraint(constraint: string): Promise<string> {
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
    const jxpath = await loadJxpath();
    const parsed = jxpath.parse(processedExpr);
    if (!parsed) {
      throw new Error(
        `jxpath.parse returned null/undefined for constraint: "${processedExpr}"`,
      );
    }
    return transpile(parsed);
  } catch (error: unknown) {
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

  // Preprocess: normalize operators to lowercase for jsxpath compatibility
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
