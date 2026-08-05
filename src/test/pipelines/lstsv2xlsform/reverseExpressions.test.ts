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
} from '../../../pipelines/xlsform2lstsv/xpathTranspiler.js';
import {
  reverseRelevance,
  reverseConstraint,
  buildSelectContext,
} from '../../../pipelines/lstsv2xlsform/reverseExpressions.js';

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
