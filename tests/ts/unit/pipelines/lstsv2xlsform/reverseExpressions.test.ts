/**
 * Reverse relevance/constraint (EM → XPath) validated against the REAL forward
 * transpiler as an oracle: forward(xpath) → EM, reverse(EM) → xpath',
 * forward(xpath') → EM'. Assert EM === EM' — a stronger, whitespace-agnostic
 * check than hand-predicting the exact reversed XPath string.
 */
import { describe, test, expect } from 'vitest';

import {
  convertRelevance,
  convertConstraint,
  TranspilerContext,
} from '../../../../../src/pipelines/xlsform2lstsv/xpathTranspiler.js';
import {
  reverseRelevance,
  reverseConstraint,
  buildSelectContext,
} from '../../../../../src/pipelines/lstsv2xlsform/reverseExpressions.js';

// Mirrors xlsformConverter's buildTranspilerContext for a fixed universe of
// select_multiple fields, with identity answer-code lookup (code === value,
// matching our reconstruction where the choice `name` already is the code).
const SELECT_MULTIPLE_FIELDS = new Set(['langs']);

function forwardCtx(): TranspilerContext {
  return {
    lookupAnswerCode: (_field, value) => value,
    getTruncatedFieldName: (field) => field,
    buildSelectedExpr: (field, value) =>
      SELECT_MULTIPLE_FIELDS.has(field)
        ? `(${field}_${value}.NAOK == 'Y')`
        : `(${field}.NAOK=='${value}')`,
  };
}

const selectCtx = buildSelectContext([
  { name: 'langs', codes: ['de', 'en', 'fr'] },
]);

async function roundTrip(xpath: string): Promise<{ em: string; em2: string }> {
  const em = await convertRelevance(xpath, forwardCtx());
  const reversedXPath = reverseRelevance(em, selectCtx);
  const em2 = await convertRelevance(reversedXPath, forwardCtx());
  return { em, em2 };
}

describe('reverseRelevance — round-trips the forward dialect', () => {
  test.each([
    ["${a} = 'x'", 'plain equality'],
    ["${a} != 'x'", 'inequality'],
    ['${age} >= 18', 'comparison'],
    ['${age} >= 18 and ${age} <= 65', 'and'],
    ["${a} = 'x' or ${b} = 'y'", 'or'],
    ["not(${a} = 'x')", 'not'],
    ["selected(${color}, 'red')", 'selected on select_one'],
    ["selected(${langs}, 'de')", 'selected on select_multiple'],
    [
      "selected(${langs}, 'de') and selected(${color}, 'red')",
      'mixed selected + and',
    ],
    ['round(${x})', 'round'],
    ['floor(${x})', 'floor'],
    ['ceiling(${x})', 'ceiling'],
    ['substring(${x}, 1, 3)', 'substring'],
    ['string-length(${x})', 'string-length'],
    ["starts-with(${x}, 'a')", 'starts-with'],
    ["ends-with(${x}, 'a')", 'ends-with'],
    ['normalize-space(${x})', 'normalize-space'],
    ["contains(${x}, 'a')", 'contains'],
    ['today()', 'today'],
    ['now()', 'now'],
    ['count(${langs}) > 1', 'count'],
    ['sum(${a}) > 1', 'sum'],
    ['${a} + ${b} > 10', 'plus'],
    ['${a} - ${b} > 10', 'minus'],
    ['${a} * ${b} > 10', 'times'],
    ['${a} div ${b} > 10', 'div'],
    ['${a} mod 2 = 0', 'mod'],
    ['if(${a} > 1, 2, 3) = 2', 'if'],
    ["regex(${x}, '^[0-9]+$')", 'regex'],
    ['round(floor(${x}) * 2) > 3', 'nested calls'],
    ["${a} = 'x' and (${b} = 'y' or ${c} = 'z')", 'or inside and (#98)'],
    ['(${a} + ${b}) * 2 > 3', 'sum inside product (#98)'],
    ['${a} - (${b} - ${c}) > 0', 'right-nested minus (#98)'],
    ['${x} = -5', 'negative literal (#98)'],
    ['${x} > -(${y} + 1)', 'negated group (#98)'],
    [`\${a} = "it's"`, 'a value with an apostrophe (#98)'],
  ])('%s (%s)', async (xpath) => {
    const { em, em2 } = await roundTrip(xpath);
    expect(em2).toBe(em);
    expect(em).not.toBe('1'); // sanity: forward actually parsed it
  });
});

describe('reverseRelevance — direct unit checks', () => {
  test('empty / "1" reverses to no relevance', () => {
    expect(reverseRelevance('', selectCtx)).toBe('');
    expect(reverseRelevance('1', selectCtx)).toBe('');
  });

  test('the fixed other-pattern relevance reverses exactly', () => {
    expect(reverseRelevance("aufmerksam == 'other'", selectCtx)).toBe(
      "${aufmerksam} = 'other'",
    );
  });

  test('rejects an unsupported function', () => {
    expect(() => reverseRelevance('unknownFunc(x)', selectCtx)).toThrow(
      /unsupported function/,
    );
  });

  test('rejects .NAOK compared to a non-string literal', () => {
    expect(() => reverseRelevance('x.NAOK == 5', selectCtx)).toThrow(
      /string literal/,
    );
  });
});

// Constraint uses the same forward-oracle strategy as relevance above, but
// through `convertConstraint` — which the forward path calls with NO
// TranspilerContext, so `.` becomes `self` and `selected()` degrades to a plain
// unmarked equality (see reverseExpressions.ts docstring).
async function constraintRoundTrip(
  xpath: string,
): Promise<{ em: string; em2: string }> {
  const em = await convertConstraint(xpath);
  const em2 = await convertConstraint(reverseConstraint(em));
  return { em, em2 };
}

describe('reverseConstraint — round-trips the forward dialect', () => {
  test.each([
    ['. >= 18', 'self comparison'],
    ['. >= 1 and . <= 100', 'and range'],
    [". != 'x'", 'self inequality'],
    ['. > today()', 'today function'],
    ['. > now()', 'now function'],
    ['string-length(.) <= 10', 'string-length on self'],
    ['${age} > 5', 'field reference'],
    ['${age} >= 18 and ${age} <= 65', 'field range'],
    ["contains(., 'x')", 'contains on self'],
    ['round(${x}) > 2', 'round'],
    ["regex(., '^[A-Z]{2}$')", 'regex on self'],
    ['. mod 5 = 0', 'mod on self'],
  ])('%s (%s)', async (xpath) => {
    const { em, em2 } = await constraintRoundTrip(xpath);
    expect(em2).toBe(em);
    expect(em).not.toBe(''); // sanity: forward actually parsed it
  });
});

describe('reverseConstraint — direct unit checks', () => {
  test('empty reverses to no constraint', () => {
    expect(reverseConstraint('')).toBe('');
  });

  test('simple comparison reverses correctly', () => {
    expect(reverseConstraint('self >= 18')).toBe('. >= 18');
  });

  test('range with and reverses correctly', () => {
    expect(reverseConstraint('self >= 1 and self <= 100')).toBe(
      '. >= 1 and . <= 100',
    );
  });
});

describe('rejects EM outside the forward dialect (em-unsupported)', () => {
  // Each input is valid-looking EM the forward transpiler never writes; the
  // reverse must refuse it rather than guess.
  test.each([
    ['a b', 'two operands without an operator'],
    ['== 1', 'operator without a left operand'],
    ['a ==', 'operator without a right operand'],
    ['!x', 'C-style negation'],
    ['a & b', 'bitwise and'],
    ["'x", 'unterminated string'],
    ['a # b', 'unknown character'],
    ['unknownfn(a)', 'unknown function'],
    ["langs_de.NAOK == 'N'", "a select_multiple marker compared with 'N'"],
    ["'x' == a.NAOK", 'a NAOK marker on the right'],
    ['a.NAOK > 1', 'a NAOK marker outside =='],
    ['a.NAOK == b', 'a NAOK marker compared with a non-string'],
  ])('%s (%s)', (em) => {
    expect(() => reverseRelevance(em, selectCtx)).toThrow(
      expect.objectContaining({ code: 'em-unsupported' }),
    );
  });
});

describe('reverseRelevance — exact output for #98', () => {
  test('grouping is kept only where precedence needs it', () => {
    expect(reverseRelevance('a == 1 and (b == 2 or c == 3)', selectCtx)).toBe(
      '${a} = 1 and (${b} = 2 or ${c} = 3)',
    );
    expect(reverseRelevance('(a == 1 and b == 2) or c == 3', selectCtx)).toBe(
      '${a} = 1 and ${b} = 2 or ${c} = 3',
    );
  });

  test('negative numbers', () => {
    expect(reverseRelevance('x == -5', selectCtx)).toBe('${x} = -5');
  });

  test('a value with an apostrophe is double-quoted', () => {
    expect(reverseRelevance(`a == "it's"`, selectCtx)).toBe(`\${a} = "it's"`);
  });
});
