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
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: c });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: c });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: c });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== quote) {
        value += src[j];
        j++;
      }
      if (j >= src.length)
        throw new Error(`unterminated string literal in: ${src}`);
      tokens.push({ type: 'str', value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: 'num', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (MULTI_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if (SINGLE_CHAR_OPS.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    throw new Error(`unsupported character "${c}" in expression: ${src}`);
  }
  return tokens;
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
    if (!tok) throw new Error('unexpected end of expression');
    this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.next();
    if (tok.type !== type) {
      throw new Error(`expected ${type}, got "${tok.value}"`);
    }
    return tok;
  }

  parse(): EmNode {
    const node = this.parseBinary(1);
    if (this.pos < this.tokens.length) {
      throw new Error(`unexpected trailing token "${this.peek()!.value}"`);
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
    throw new Error(`unexpected token "${tok.value}"`);
  }
}

/** Parse an Expression Manager string into an {@link EmNode} AST. */
export function parseEm(src: string): EmNode {
  return new Parser(tokenize(src)).parse();
}
