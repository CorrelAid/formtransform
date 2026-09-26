/**
 * Reverse `relevant`/`constraint`: LimeSurvey Expression Manager text → XPath.
 *
 * Only inverts the dialect `xpathTranspiler.ts` emits (see `emParser.ts`).
 * `selected()` reconstruction needs to know which fields are select_one vs
 * select_multiple — that context comes from the survey already reconstructed
 * so far (see {@link buildSelectContext}), mirroring how the forward path's
 * `buildSelectedExpr` needed the same type information.
 *
 * `relevant` and `constraint` need different handling because the forward
 * path transpiles them differently:
 *   - `relevant` goes through `xpathToLimeSurvey(xpath, ctx)` — WITH the full
 *     `TranspilerContext`, so `selected()` compiles to the `.NAOK`-suffixed
 *     forms (`reverseRelevance`, needs a `SelectContext`).
 *   - `constraint` goes through `convertConstraint(xpath)` — called with NO
 *     context, so `selected()` falls back to a plain, unmarked
 *     `(field=="value")` — syntactically indistinguishable from a plain
 *     equality once transpiled. `reverseConstraint` always reverses this shape
 *     as plain equality (`${field} = 'value'`), which is the correct
 *     counterpart to forward's own simplified (context-free) constraint
 *     handling, not a separate loss on top of it.
 *
 * NOT implemented: `convertConstraint`'s separate early-return path for a
 * literal `regexMatch(...)` substring in the *original* XPath text (an
 * escape-hatch letting authors write EM-flavored syntax directly in
 * `constraint`) swaps `regexMatch(pattern, field)`'s argument order relative
 * to the generic `transpile()` path's `regexMatch(field, pattern)`. Once
 * transpiled, both look identical in the TSV, so which order applies can't be
 * determined on the way back — `reverseConstraint` always assumes the
 * generic (unswapped) order. No fixture uses either form.
 *
 * `calculation` is out of scope entirely: the `calculate` XLSForm type isn't
 * registered, so the forward converter rejects it and never produces a
 * `calculate` question in a TSV for this to reverse. Revisit if it is.
 */

import { parseEm, EmNode } from './emParser.js';
import { ConversionError } from '../../diagnostics.js';

export interface SelectContext {
  /** `${qname}_${code}` → the select_multiple question + choice it refers to. */
  multipleCompounds: Map<string, { question: string; code: string }>;
}

/** Build the lookup `emToXPath` needs to reconstruct `selected()` calls. */
export function buildSelectContext(
  selectMultiple: Array<{ name: string; codes: string[] }>,
): SelectContext {
  const multipleCompounds = new Map<
    string,
    { question: string; code: string }
  >();
  for (const q of selectMultiple) {
    for (const code of q.codes) {
      multipleCompounds.set(`${q.name}_${code}`, { question: q.name, code });
    }
  }
  return { multipleCompounds };
}

const FUNCTION_NAME_TO_XPATH: Record<string, string> = {
  count: 'count',
  regexMatch: 'regex',
  contains: 'contains',
  floor: 'floor',
  ceil: 'ceiling',
  round: 'round',
  sum: 'sum',
  substr: 'substring',
  strlen: 'string-length',
  startsWith: 'starts-with',
  endsWith: 'ends-with',
  trim: 'normalize-space',
  if: 'if',
  today: 'today',
  now: 'now',
};

const BINARY_OP_TO_XPATH: Record<string, string> = {
  '==': '=',
  '!=': '!=',
  '<=': '<=',
  '>=': '>=',
  '<': '<',
  '>': '>',
  '+': '+',
  '-': '-',
  '*': '*',
  '/': 'div',
  '%': 'mod',
  and: 'and',
  or: 'or',
};

function quote(v: string): string {
  return `'${v}'`;
}

function nodeToXPath(node: EmNode, ctx: SelectContext): string {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'str':
      return quote(node.v);
    case 'ident':
      if (node.naok) {
        throw new ConversionError(
          'em-unsupported',
          `"${node.name}.NAOK" only supported directly inside a selected()-style "==" comparison`,
        );
      }
      if (node.name === 'self') return '.';
      return `\${${node.name}}`;
    case 'unary':
      return `not(${nodeToXPath(node.arg, ctx)})`;
    case 'call': {
      const xfName = FUNCTION_NAME_TO_XPATH[node.name];
      if (!xfName) {
        throw new ConversionError(
          'em-unsupported',
          `unsupported function "${node.name}()"`,
        );
      }
      const args = node.args.map((a) => nodeToXPath(a, ctx)).join(', ');
      return `${xfName}(${args})`;
    }
    case 'bin':
      return binToXPath(node, ctx);
  }
}

function binToXPath(node: EmNode & { t: 'bin' }, ctx: SelectContext): string {
  const { op, left, right } = node;

  // `(name.NAOK=='code')` / `(name_code.NAOK=='Y')` → selected(${...}, '...').
  if (op === '==' && left.t === 'ident' && left.naok) {
    if (right.t !== 'str') {
      throw new ConversionError(
        'em-unsupported',
        `"${left.name}.NAOK == ..." must compare against a string literal`,
      );
    }
    const compound = ctx.multipleCompounds.get(left.name);
    if (compound) {
      if (right.v !== 'Y') {
        throw new ConversionError(
          'em-unsupported',
          `select_multiple selected-marker "${left.name}.NAOK" must compare against 'Y', got '${right.v}'`,
        );
      }
      return `selected(\${${compound.question}}, '${compound.code}')`;
    }
    return `selected(\${${left.name}}, '${right.v}')`;
  }
  if (right.t === 'ident' && right.naok) {
    // Forward only ever puts the NAOK marker on the left side; a right-side
    // marker is outside the dialect we invert.
    throw new ConversionError(
      'em-unsupported',
      `"${right.name}.NAOK" is only supported on the left side`,
    );
  }

  const xfOp = BINARY_OP_TO_XPATH[op];
  if (!xfOp)
    throw new ConversionError('em-unsupported', `unsupported operator "${op}"`);
  return `${nodeToXPath(left, ctx)} ${xfOp} ${nodeToXPath(right, ctx)}`;
}

/**
 * Reverse a LimeSurvey relevance string to XPath. `'1'` (LimeSurvey's
 * "always true" default) maps to `''` (XLSForm's "no relevance" default).
 *
 * @throws on any construct outside the forward transpiler's dialect.
 */
export function reverseRelevance(em: string, ctx: SelectContext): string {
  const trimmed = em.trim();
  if (trimmed === '' || trimmed === '1') return '';
  return nodeToXPath(parseEm(trimmed), ctx);
}

/** No select_multiple context: `constraint` is transpiled without one (see
 * module docstring), so `.NAOK` markers never appear in its EM text. */
const NO_SELECT_CONTEXT: SelectContext = buildSelectContext([]);

/**
 * Reverse a LimeSurvey `em_validation_q` (constraint) string to XPath.
 * Empty maps to `''` (no constraint).
 *
 * @throws on any construct outside the forward transpiler's dialect.
 */
export function reverseConstraint(em: string): string {
  const trimmed = em.trim();
  if (!trimmed) return '';
  return nodeToXPath(parseEm(trimmed), NO_SELECT_CONTEXT);
}
