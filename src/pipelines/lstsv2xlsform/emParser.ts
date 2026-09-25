import { ConversionError } from '../../diagnostics.js';
/**
 * Parse the (bounded) LimeSurvey Expression Manager dialect the forward
 * transpiler emits (`src/converters/xpathTranspiler.ts`) and serialize it back
 * to XPath. This is NOT a general EM parser — it covers exactly the operators
 * and functions `transpile()` produces, and throws on anything else, so an
 * unsupported construct is rejected rather than silently mistranslated (same
 * philosophy as `validateLstsvSubset`).
 *
 * Forward dialect → XPath, inverted here:
 *   - `==`/`!=`/`<=`/`>=`/`<`/`>`   → `=`/`!=`/`<=`/`>=`/`<`/`>`
 *   - `and`/`or`                   → `and`/`or`
 *   - `!(expr)`                    → `not(expr)`
 *   - `+ - * /` → `+ - * div`; `%` → `mod`
 *   - function renames: floor→floor, ceil→ceiling, round→round, sum→sum,
 *     substr→substring, strlen→string-length, startsWith→starts-with,
 *     endsWith→ends-with, trim→normalize-space, regexMatch→regex,
 *     contains/count/if/today/now → identical
 *   - a bare field name                → `${name}`
 *   - `(name.NAOK=='code')`            → `selected(${name}, 'code')` (select_one)
 *   - `(name_code.NAOK=='Y')`          → `selected(${name}, 'code')` (select_multiple)
 *
 * NOT reversed (forward collapses these onto the same output, ambiguously):
 *   - `+` used for string `concat()` vs numeric addition — always emitted as
 *     XPath `+` (arithmetic); `concat()` is not reconstructed.
 */

// ── Tokenizer ─────────────────────────────────────────────────────────────

type TokenType = 'num' | 'str' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';
interface Token {
  type: TokenType;
  value: string;
}

const MULTI_CHAR_OPS = ['==', '!=', '<=', '>='];
const SINGLE_CHAR_OPS = ['<', '>', '+', '-', '*', '/', '%', '!'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const { token, next } = scanAt(src, i);
    if (token) tokens.push(token);
    i = next;
  }
  return tokens;
}

/** Identify what kind of token starts at `i` and return it (or `null` for trivia). */
function scanAt(src: string, i: number): { token: Token | null; next: number } {
  const c = src[i];
  if (/\s/.test(c)) return { token: null, next: i + 1 };
  if (c === '(') return { token: { type: 'lparen', value: c }, next: i + 1 };
  if (c === ')') return { token: { type: 'rparen', value: c }, next: i + 1 };
  if (c === ',') return { token: { type: 'comma', value: c }, next: i + 1 };
  if (c === "'" || c === '"') return scanString(src, i, c);
  if (/[0-9]/.test(c)) return scanNumber(src, i);
  if (/[A-Za-z_]/.test(c)) return scanIdent(src, i);
  return scanOperator(src, i);
}

/** Quoted string literal starting at `i` with the given `quote` char. */
function scanString(
  src: string,
  i: number,
  quote: string,
): { token: Token; next: number } {
  let j = i + 1;
  while (j < src.length && src[j] !== quote) j++;
  if (j >= src.length) {
    throw new ConversionError(
      'em-unsupported',
      `unterminated string literal in: ${src}`,
    );
  }
  return { token: { type: 'str', value: src.slice(i + 1, j) }, next: j + 1 };
}

/** Numeric literal (digits + at most one dot) starting at `i`. */
function scanNumber(src: string, i: number): { token: Token; next: number } {
  let j = i;
  while (j < src.length && /[0-9.]/.test(src[j])) j++;
  return { token: { type: 'num', value: src.slice(i, j) }, next: j };
}

/** Identifier (`[A-Za-z_][A-Za-z0-9_.]*`) — possibly `.NAOK` suffixed. */
function scanIdent(src: string, i: number): { token: Token; next: number } {
  let j = i;
  while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
  return { token: { type: 'ident', value: src.slice(i, j) }, next: j };
}

/** Two-char operator if present, else single-char. Unknowns throw. */
function scanOperator(src: string, i: number): { token: Token; next: number } {
  const two = src.slice(i, i + 2);
  if (MULTI_CHAR_OPS.includes(two)) {
    return { token: { type: 'op', value: two }, next: i + 2 };
  }
  if (SINGLE_CHAR_OPS.includes(src[i])) {
    return { token: { type: 'op', value: src[i] }, next: i + 1 };
  }
  throw new ConversionError(
    'em-unsupported',
    `unsupported character "${src[i]}" in expression: ${src}`,
  );
}

// ── AST ───────────────────────────────────────────────────────────────────

export type EmNode =
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ident'; name: string; naok: boolean }
  | { t: 'call'; name: string; args: EmNode[] }
  | { t: 'unary'; op: '!'; arg: EmNode }
  | { t: 'bin'; op: string; left: EmNode; right: EmNode };

// Precedence climbing: or(1) < and(2) < comparisons(3) < +-(4) < */%(5).
const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 3,
  '!=': 3,
  '<=': 3,
  '>=': 3,
  '<': 3,
  '>': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
};

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const tok = this.tokens[this.pos];
    if (!tok)
      throw new ConversionError(
        'em-unsupported',
        'unexpected end of expression',
      );
    this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.next();
    if (tok.type !== type) {
      throw new ConversionError(
        'em-unsupported',
        `expected ${type}, got "${tok.value}"`,
      );
    }
    return tok;
  }

  parse(): EmNode {
    const node = this.parseBinary(1);
    if (this.pos < this.tokens.length) {
      throw new ConversionError(
        'em-unsupported',
        `unexpected trailing token "${this.peek()!.value}"`,
      );
    }
    return node;
  }

  private parseBinary(minPrec: number): EmNode {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (!tok) break;
      const opName = tok.type === 'ident' ? tok.value : tok.value;
      if (tok.type === 'ident' && opName !== 'and' && opName !== 'or') break;
      if (tok.type !== 'op' && tok.type !== 'ident') break;
      const prec = BINARY_PRECEDENCE[opName];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { t: 'bin', op: opName, left, right };
    }
    return left;
  }

  private parseUnary(): EmNode {
    const tok = this.peek();
    if (tok?.type === 'op' && tok.value === '!') {
      this.next();
      this.expect('lparen');
      const arg = this.parseBinary(1);
      this.expect('rparen');
      return { t: 'unary', op: '!', arg };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): EmNode {
    const tok = this.next();
    if (tok.type === 'num') return { t: 'num', v: tok.value };
    if (tok.type === 'str') return { t: 'str', v: tok.value };
    if (tok.type === 'lparen') {
      const inner = this.parseBinary(1);
      this.expect('rparen');
      return inner;
    }
    if (tok.type === 'ident') {
      if (this.peek()?.type === 'lparen') {
        this.next();
        const args: EmNode[] = [];
        if (this.peek()?.type !== 'rparen') {
          args.push(this.parseBinary(1));
          while (this.peek()?.type === 'comma') {
            this.next();
            args.push(this.parseBinary(1));
          }
        }
        this.expect('rparen');
        return { t: 'call', name: tok.value, args };
      }
      const naok = tok.value.endsWith('.NAOK');
      const name = naok ? tok.value.slice(0, -'.NAOK'.length) : tok.value;
      return { t: 'ident', name, naok };
    }
    throw new ConversionError(
      'em-unsupported',
      `unexpected token "${tok.value}"`,
    );
  }
}

/** Parse an Expression Manager string into an {@link EmNode} AST. */
export function parseEm(src: string): EmNode {
  return new Parser(tokenize(src)).parse();
}
