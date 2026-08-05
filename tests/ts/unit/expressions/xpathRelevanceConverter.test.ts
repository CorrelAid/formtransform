import { describe, test, expect } from 'vitest';
import { convertRelevance } from '../../../../src/pipelines/xlsform2lstsv/xpathTranspiler';

describe('XPath Relevance Conversion', () => {
  describe('basic relevance conversions', () => {
    test('converts empty expression to "1"', async () => {
      expect(await convertRelevance('')).toBe('1');
      expect(await convertRelevance(undefined as any)).toBe('1');
    });

    test('converts field references ${field} to field (LimeSurvey format)', async () => {
      expect(await convertRelevance('${age} > 18')).toBe('age > 18');
    });

    test('converts = to ==', async () => {
      expect(await convertRelevance('${x} = 5')).toContain('==');
    });

    test('preserves != operator', async () => {
      const result = await convertRelevance('${x} != 5');
      expect(result).toContain('!=');
    });

    test('preserves comparison operators', async () => {
      expect(await convertRelevance('${x} > 5')).toContain('>');
      expect(await convertRelevance('${x} < 5')).toContain('<');
      expect(await convertRelevance('${x} >= 5')).toContain('>=');
      expect(await convertRelevance('${x} <= 5')).toContain('<=');
    });
  });

  describe('selected() function in relevance', () => {
    test('converts selected() with single quotes', async () => {
      const result = await convertRelevance("selected(${field}, 'value')");
      expect(result).toContain('field');
      expect(result).not.toContain('{field}');
      expect(result).toContain('==');
      expect(result).toContain('"value"');
    });

    test('converts selected() with double quotes', async () => {
      const result = await convertRelevance('selected(${field}, "value")');
      expect(result).toContain('field');
      expect(result).not.toContain('{field}');
      expect(result).toContain('==');
      expect(result).toContain('"value"');
    });

    test('handles selected() without spaces', async () => {
      const result = await convertRelevance("selected(${married},'yes')");
      expect(result).toContain('married');
      expect(result).not.toContain('{married}');
      expect(result).toContain('==');
      expect(result).toContain('"yes"');
    });

    test('handles selected() with spaces', async () => {
      const result = await convertRelevance("selected( ${field} , 'value' )");
      expect(result).toContain('field');
      expect(result).not.toContain('{field}');
      expect(result).toContain('==');
    });
  });

  describe('boolean operators in relevance', () => {
    test('converts "and" to " and "', async () => {
      const result = await convertRelevance('${x} > 5 and ${y} < 10');
      expect(result).toContain(' and ');
    });

    test('converts "or" to " or "', async () => {
      const result = await convertRelevance('${x} = 1 or ${x} = 2');
      expect(result).toContain(' or ');
    });

    test('handles AND in uppercase', async () => {
      const result = await convertRelevance('${x} > 5 AND ${y} < 10');
      expect(result).toContain(' and ');
    });

    test('handles OR in uppercase', async () => {
      const result = await convertRelevance('${x} = 1 OR ${x} = 2');
      expect(result).toContain(' or ');
    });

    test('handles mixed case boolean operators', async () => {
      const result = await convertRelevance('${x} > 5 And ${y} < 10');
      expect(result).toContain(' and ');
    });
  });

  describe('current field reference in relevance', () => {
    test('converts . to self at start of expression', async () => {
      const result = await convertRelevance('. != ""');
      expect(result).toContain('self');
    });

    test('converts . followed by space', async () => {
      const result = await convertRelevance('. > 0');
      expect(result).toContain('self');
    });

    test('converts . followed by parenthesis', async () => {
      const result = await convertRelevance('. >= 18 and . <= 100');
      expect(result).toContain('self');
    });
  });

  describe('complex relevance expressions', () => {
    test('converts complex boolean expression', async () => {
      const result = await convertRelevance(
        "${age} >= 18 and ${country} = 'USA' or ${country} = 'Canada'",
      );
      expect(result).toContain('age');
      expect(result).not.toContain('{age}');
      expect(result).toContain('country');
      expect(result).not.toContain('{country}');
      expect(result).toContain('>=');
      expect(result).toContain('==');
      expect(result).toContain(' and ');
      expect(result).toContain(' or ');
    });

    test('converts multiple selected() calls', async () => {
      const result = await convertRelevance(
        "selected(${q1}, 'yes') and selected(${q2}, 'no')",
      );
      expect(result).toContain('q1');
      expect(result).not.toContain('{q1}');
      expect(result).toContain('q2');
      expect(result).not.toContain('{q2}');
      expect(result).toContain(' and ');
    });

    test('handles mixed field references and operators', async () => {
      const result = await convertRelevance(
        '${income} > 0 and ${tax} < ${income} and ${tax} >= 0',
      );
      expect(result).toContain('income');
      expect(result).not.toContain('{income}');
      expect(result).toContain('tax');
      expect(result).not.toContain('{tax}');
      expect(result).toContain('>');
      expect(result).toContain('<');
      expect(result).toContain('>=');
    });
  });

  describe('edge cases in relevance expressions', () => {
    test('converts nested if() expressions', async () => {
      const result = await convertRelevance(
        "if(${age} < 18, 'minor', if(${age} < 65, 'adult', 'senior'))",
      );
      expect(result).toContain('if(');
      expect(result).toContain('age');
      expect(result).not.toContain('{age}');
    });

    test('converts complex nested boolean logic', async () => {
      const result = await convertRelevance(
        "(${consent} = 'yes' and ${age} >= 18) or (${country} = 'USA' and ${gender} = 'male')",
      );
      expect(result).toContain('consent');
      expect(result).toContain('age');
      expect(result).toContain('country');
      expect(result).toContain('gender');
      expect(result).toContain(' and ');
      expect(result).toContain(' or ');
    });

    test('handles multiple parentheses levels', async () => {
      const result = await convertRelevance(
        "(((${field1} != '') and (${field2} != '')) or (${field3} = 'test'))",
      );
      expect(result).toContain('field1');
      expect(result).toContain('field2');
      expect(result).toContain('field3');
    });
  });

  describe('edge cases', () => {
    test('handles expressions with numbers', async () => {
      const result = await convertRelevance('${x} = 123');
      expect(result).toContain('x');
      expect(result).not.toContain('{x}');
      expect(result).toContain('123');
    });

    test('handles expressions with quoted strings', async () => {
      const result = await convertRelevance('${name} = "John Doe"');
      expect(result).toContain('name');
      expect(result).not.toContain('{name}');
      expect(result).toContain('"John Doe"');
    });

    test('handles expressions with empty strings', async () => {
      const result = await convertRelevance('${field} != ""');
      expect(result).toContain('field');
      expect(result).not.toContain('{field}');
      expect(result).toContain('!=');
      expect(result).toContain('""');
    });

    test('preserves parentheses in function calls', async () => {
      const result = await convertRelevance('count(${a}) + count(${b})');
      expect(result).toContain('(');
      expect(result).toContain(')');
    });

    test('trims whitespace', async () => {
      const result = await convertRelevance('  ${x} = 5  ');
      expect(result).not.toMatch(/^\s/);
      expect(result).not.toMatch(/\s$/);
    });
  });
});
