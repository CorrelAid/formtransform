/**
 * Parser for the XPath 1.0 subset XLSForm expressions use.
 *
 * Replaces the `js-xpath` dependency (unmaintained, and broken in browser
 * bundles: a strict-mode `this.alert` and a bare `require`, formtransform#23).
 * Plain TypeScript with no dependencies, so it behaves the same in Node and
 * in any bundler.
 *
 * Supported: string and number literals, `.` (the current field), bare field
 * names (what `${field}` references become after preprocessing), function
 * calls, unary minus, parentheses, and the operators `or and = != < <= > >=
 * + - * div mod` with XPath 1.0 precedence.
 *
 * Everything else a full XPath parser would accept — location paths with `/`,
 * `..`, `@attr`, predicates, unions, `$var` — throws {@link XPathSyntaxError}.
 * XLSForm references fields with `${name}`, so those constructs only appear in
 * hand-written XPath, and translating them to LimeSurvey by guesswork is how
 * skip logic silently goes wrong. Refuse instead.
 */

export type XPathNode =
  | { kind: 'num'; text: string }
  | { kind: 'str'; value: string; delim: '"' | "'" }
  /** A field reference; `name: null` is `.` (the current field). */
  | { kind: 'path'; name: string | null }
  | { kind: 'call'; name: string; args: XPathNode[] }
  | { kind: 'bin'; op: BinaryOp; left: XPathNode; right: XPathNode }
  | { kind: 'neg'; operand: XPathNode };

export type BinaryOp =
  | 'or'
  | 'and'
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '+'
  | '-'
  | '*'
  | 'div'
  | 'mod';

export class XPathSyntaxError extends Error {
  constructor(
    message: string,
    readonly expression: string,
    readonly position: number,
  ) {
    super(`${message} at position ${position} in: ${expression}`);
    this.name = 'XPathSyntaxError';
  }
}

/** Binding strength per XPath 1.0 (higher binds tighter). */
export const PRECEDENCE: Record<BinaryOp, number> = {
  or: 1,
  and: 2,
  '=': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  div: 6,
  mod: 6,
};
/** Unary minus binds tighter than any binary operator. */
export const UNARY_PRECEDENCE = 7;

type Token =
  | { t: 'num'; v: string; pos: number }
  | { t: 'str'; v: string; delim: '"' | "'"; pos: number }
  | { t: 'name'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number };

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_.-]/;
const OPERATOR_NAMES = new Set(['and', 'or', 'div', 'mod']);

/** Tokens after which `and`/`or`/`div`/`mod`/`*` are operators (XPath 3.7). */
function endsOperand(tok: Token | undefined): boolean {
  if (!tok) return false;
  if (tok.t === 'num' || tok.t === 'str' || tok.t === 'name') return true;
  return tok.t === 'op' && (tok.v === ')' || tok.v === '.');
}

function readName(expr: string, start: number): number {
  let i = start + 1;
  while (i < expr.length && NAME_CHAR.test(expr[i])) i++;
  // QName prefix (`jr:choice-name`); `::` would be an axis, rejected later.
  if (
    expr[i] === ':' &&
    expr[i + 1] !== ':' &&
    NAME_START.test(expr[i + 1] ?? '')
  ) {
    i += 2;
    while (i < expr.length && NAME_CHAR.test(expr[i])) i++;
  }
  return i;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = i;
    if (c === '"' || c === "'") {
      const end = expr.indexOf(c, i + 1);
      if (end === -1) {
        throw new XPathSyntaxError('unterminated string', expr, pos);
      }
      tokens.push({ t: 'str', v: expr.slice(i + 1, end), delim: c, pos });
      i = end + 1;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)/.exec(expr.slice(i));
    if (num) {
      tokens.push({ t: 'num', v: num[0], pos });
      i += num[0].length;
      continue;
    }
    if (NAME_START.test(c)) {
      const end = readName(expr, i);
      const v = expr.slice(i, end);
      const isOperator =
        OPERATOR_NAMES.has(v) && endsOperand(tokens[tokens.length - 1]);
      tokens.push({ t: isOperator ? 'op' : 'name', v, pos });
      i = end;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (['!=', '<=', '>=', '..', '//', '::'].includes(two)) {
      tokens.push({ t: 'op', v: two, pos });
      i += 2;
      continue;
    }
    if ('()[],=<>+-*/|.@$'.includes(c)) {
      tokens.push({ t: 'op', v: c, pos });
      i++;
      continue;
    }
    throw new XPathSyntaxError(`unexpected character '${c}'`, expr, pos);
  }
  tokens.push({ t: 'end', pos: expr.length });
  return tokens;
}

const UNSUPPORTED: Record<string, string> = {
  '/': 'location paths with "/" are not supported; reference fields as ${name}',
  '//': 'location paths with "//" are not supported; reference fields as ${name}',
  '..': 'the parent step ".." is not supported; reference fields as ${name}',
  '@': 'attribute references are not supported',
  '[': 'predicates are not supported',
  '|': 'union expressions are not supported',
  $: 'XPath variables ($name) are not supported; use ${name}',
  '::': 'axis steps are not supported; reference fields as ${name}',
};

class Parser {
  private i = 0;
  constructor(
    private readonly expr: string,
    private readonly tokens: Token[],
  ) {}

  private peek(): Token {
    return this.tokens[this.i];
  }

  private fail(message: string, tok: Token = this.peek()): never {
    throw new XPathSyntaxError(message, this.expr, tok.pos);
  }

  private isOp(v: string): boolean {
    const tok = this.peek();
    return tok.t === 'op' && tok.v === v;
  }

  private expect(v: string): void {
    if (!this.isOp(v)) this.fail(`expected '${v}'`);
    this.i++;
  }

  parse(): XPathNode {
    if (this.peek().t === 'end') this.fail('empty expression');
    const node = this.binary(1);
    const tok = this.peek();
    if (tok.t !== 'end') {
      if (tok.t === 'op' && UNSUPPORTED[tok.v]) this.fail(UNSUPPORTED[tok.v]);
      this.fail(
        `unexpected '${tok.t === 'op' || tok.t === 'name' ? tok.v : tok.t}'`,
      );
    }
    return node;
  }

  /** Precedence climbing over the left-associative binary operators. */
  private binary(minPrec: number): XPathNode {
    let left = this.unary();
    for (;;) {
      const tok = this.peek();
      if (tok.t !== 'op' || !(tok.v in PRECEDENCE)) return left;
      const op = tok.v as BinaryOp;
      const prec = PRECEDENCE[op];
      if (prec < minPrec) return left;
      this.i++;
      const right = this.binary(prec + 1);
      left = { kind: 'bin', op, left, right };
    }
  }

  private unary(): XPathNode {
    if (this.isOp('-')) {
      this.i++;
      return { kind: 'neg', operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): XPathNode {
    const tok = this.peek();
    if (tok.t === 'num') {
      this.i++;
      return { kind: 'num', text: tok.v };
    }
    if (tok.t === 'str') {
      this.i++;
      return { kind: 'str', value: tok.v, delim: tok.delim };
    }
    if (tok.t === 'name') {
      this.i++;
      if (this.isOp('(')) return this.call(tok.v);
      return this.pathEnd({ kind: 'path', name: tok.v });
    }
    if (tok.t === 'op') {
      if (tok.v === '(') {
        this.i++;
        const inner = this.binary(1);
        this.expect(')');
        return inner;
      }
      if (tok.v === '.') {
        this.i++;
        return this.pathEnd({ kind: 'path', name: null });
      }
      if (UNSUPPORTED[tok.v]) this.fail(UNSUPPORTED[tok.v]);
    }
    if (tok.t === 'end') this.fail('unexpected end of expression');
    return this.fail(`unexpected '${tok.v}'`);
  }

  /** A path may not continue into steps, predicates or unions. */
  private pathEnd(node: XPathNode): XPathNode {
    const tok = this.peek();
    if (tok.t === 'op' && UNSUPPORTED[tok.v]) this.fail(UNSUPPORTED[tok.v]);
    return node;
  }

  private call(name: string): XPathNode {
    this.expect('(');
    const args: XPathNode[] = [];
    if (!this.isOp(')')) {
      args.push(this.binary(1));
      while (this.isOp(',')) {
        this.i++;
        args.push(this.binary(1));
      }
    }
    this.expect(')');
    return { kind: 'call', name, args };
  }
}

/** Parse an XLSForm XPath expression. Throws {@link XPathSyntaxError}. */
export function parseXPath(expr: string): XPathNode {
  return new Parser(expr, tokenize(expr)).parse();
}
