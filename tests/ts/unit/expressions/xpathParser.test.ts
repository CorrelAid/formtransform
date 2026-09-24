/** XLSForm XPath parser + EM transpilation: precedence, refusals, no silent '1'. */
import { describe, expect, test } from 'vitest';

import {
  XPathSyntaxError,
  parseXPath,
} from '../../../../src/pipelines/xlsform2lstsv/xpathParser.js';
import {
  convertConstraint,
  xpathToLimeSurvey,
} from '../../../../src/pipelines/xlsform2lstsv/xpathTranspiler.js';

describe('parseXPath', () => {
  test('builds a precedence-correct tree', () => {
    expect(parseXPath('a or b and c')).toEqual({
      kind: 'bin',
      op: 'or',
      left: { kind: 'path', name: 'a' },
      right: {
        kind: 'bin',
        op: 'and',
        left: { kind: 'path', name: 'b' },
        right: { kind: 'path', name: 'c' },
      },
    });
  });

  test('literals, self, calls and unary minus', () => {
    expect(parseXPath(`f(., 'x', "y", 1.5, -2)`)).toEqual({
      kind: 'call',
      name: 'f',
      args: [
        { kind: 'path', name: null },
        { kind: 'str', value: 'x', delim: "'" },
        { kind: 'str', value: 'y', delim: '"' },
        { kind: 'num', text: '1.5' },
        { kind: 'neg', operand: { kind: 'num', text: '2' } },
      ],
    });
  });

  test('and/or/div/mod are operators only after an operand', () => {
    expect(parseXPath('and div mod')).toMatchObject({
      kind: 'bin',
      op: 'div',
      left: { kind: 'path', name: 'and' },
      right: { kind: 'path', name: 'mod' },
    });
  });

  test.each([
    ['/data/q', /"\/"/],
    ['../q', /"\.\."/],
    ['q[1]', /predicates/],
    ['a | b', /union/],
    ['$x', /variables/],
    ['@id', /attribute/],
    ["'open", /unterminated string/],
    ['(a', /expected '\)'/],
    ['a +', /unexpected end/],
    ['', /empty expression/],
    ['a # b', /unexpected character/],
  ])('refuses %j', (expr, message) => {
    expect(() => parseXPath(expr)).toThrow(XPathSyntaxError);
    expect(() => parseXPath(expr)).toThrow(message);
  });
});

describe('xpathToLimeSurvey: grouping survives', () => {
  test.each([
    ['(${a} + ${b}) * ${c}', '(a + b) * c'],
    ['${a} + ${b} * ${c}', 'a + b * c'],
    ['${a} - (${b} - ${c})', 'a - (b - c)'],
    ['${a} - ${b} - ${c}', 'a - b - c'],
    ['${a} + (${b} + ${c})', 'a + b + c'],
    ['${a} div (${b} * ${c})', 'a / (b * c)'],
    ['${a} mod 2 = 0', 'a % 2 == 0'],
    ['-(${a} + ${b})', '-(a + b)'],
    ['${x} and (${y} or ${z})', 'x and (y or z)'],
    ['(${x} and ${y}) or ${z}', 'x and y or z'],
    ['not(${x} or ${y})', '!(x or y)'],
    ['concat(${a}, ${b} - ${c})', 'a + (b - c)'],
  ])('%s → %s', async (xpath, em) => {
    expect(await xpathToLimeSurvey(xpath)).toBe(em);
  });

  test('true() and false() become 1 and 0', async () => {
    expect(await xpathToLimeSurvey('if(${age} > 18, true(), false())')).toBe(
      'if(age > 18, 1, 0)',
    );
  });
});

describe('failures are loud', () => {
  test('an unsupported function rejects instead of returning "1"', async () => {
    await expect(
      xpathToLimeSurvey('jr:choice-name(${q}, "${q}")'),
    ).rejects.toThrow(
      /Cannot convert XPath expression .*Unsupported function: jr:choice-name/,
    );
  });

  test('an unparseable relevance rejects and names the expression', async () => {
    await expect(xpathToLimeSurvey('/data/q = 1')).rejects.toThrow(
      /Cannot convert XPath expression "\/data\/q = 1"/,
    );
  });

  test('empty relevance is still "always"', async () => {
    expect(await xpathToLimeSurvey('')).toBe('1');
  });

  test('a constraint that is not XPath keeps its documented fallback', async () => {
    expect(await convertConstraint('^[0-9]{5}$')).toBe('');
  });
});
