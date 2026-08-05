import { describe, test, expect } from 'vitest';
import { convertConstraint } from '../../pipelines/xlsform2lstsv/xpathTranspiler';

describe('XPath Constraint Conversion', () => {
  describe('basic constraint conversions', () => {
    test('converts empty constraint to empty string', async () => {
      expect(await convertConstraint('')).toBe('');
    });

    test('converts . to self in constraints', async () => {
      const result = await convertConstraint('. >= 18');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 18');
    });

    test('converts . to self throughout constraint', async () => {
      const result = await convertConstraint('. >= 1 and . <= 100');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 1 and self <= 100');
    });

    test('converts constraint with field references', async () => {
      const result = await convertConstraint('. > ${min_value}');
      // AST-based converter handles field references
      expect(result).toBe('self > minvalue');
    });

    test('handles regexMatch with logical condition as first argument', async () => {
      // This test case addresses the issue where regexMatch is called with a logical condition
      // instead of a regex pattern as the first argument
      const result = await convertConstraint(
        'regexMatch("self >= 18 and self <= 120", age.NAOK)',
      );
      // The converter treats the first argument as a logical expression
      expect(result).toBe('self >= 18 and self <= 120');
    });

    test('handles regexMatch with actual regex pattern', async () => {
      // Test case with a proper regex pattern to ensure it's handled differently
      const result = await convertConstraint(
        'regexMatch("^[A-Z][a-z]+$", name)',
      );
      // regex() is supported and mapped to regexMatch()
      expect(result).toBe(`regexMatch('^[A-Z][a-z]+$', name)`);
    });
  });

  describe('numeric range constraints', () => {
    test('converts constraint with range validation', async () => {
      const result = await convertConstraint('. >= 5 and . <= 100');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 5 and self <= 100');
    });

    test('converts constraint with min validation', async () => {
      const result = await convertConstraint('. >= 18');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 18');
    });

    test('converts constraint with max validation', async () => {
      const result = await convertConstraint('. <= 100');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self <= 100');
    });

    test('converts numeric range constraint', async () => {
      const result = await convertConstraint('. >= 18 and . <= 100');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 18 and self <= 100');
    });

    test('converts numeric range constraint with same digit count', async () => {
      const result = await convertConstraint('. >= 10 and . <= 99');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 10 and self <= 99');
    });

    test('converts numeric range constraint with different digit counts', async () => {
      const result = await convertConstraint('. >= 1 and . <= 100');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 1 and self <= 100');
    });
  });

  describe('min-only constraints', () => {
    test('converts constraint with minimum value', async () => {
      const result = await convertConstraint('. >= 18');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 18');
    });

    test('converts constraint with single digit minimum', async () => {
      const result = await convertConstraint('. >= 5');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 5');
    });

    test('converts constraint with three digit minimum', async () => {
      const result = await convertConstraint('. >= 100');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self >= 100');
    });
  });

  describe('max-only constraints', () => {
    test('converts constraint with maximum value', async () => {
      const result = await convertConstraint('. <= 100');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self <= 100');
    });

    test('converts constraint with single digit maximum', async () => {
      const result = await convertConstraint('. <= 9');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self <= 9');
    });

    test('converts constraint with two digit maximum', async () => {
      const result = await convertConstraint('. <= 99');
      // AST-based converter returns LimeSurvey expressions
      expect(result).toBe('self <= 99');
    });
  });

  describe('regex pattern constraints', () => {
    test('returns empty for regex patterns (not valid XPath)', async () => {
      const result = await convertConstraint('^[A-Z][a-z]+$');
      // AST-based converter cannot parse regex patterns as XPath
      expect(result).toBe('');
    });

    test('returns empty for regex patterns with anchors', async () => {
      const result = await convertConstraint('^[0-9]{5}$');
      // AST-based converter cannot parse regex patterns as XPath
      expect(result).toBe('');
    });

    test('returns empty for regex patterns with character classes', async () => {
      const result = await convertConstraint('^[A-Za-z0-9]+$');
      // AST-based converter cannot parse regex patterns as XPath
      expect(result).toBe('');
    });

    test('returns empty for regex patterns with quantifiers', async () => {
      const result = await convertConstraint('^[A-Z][a-z]{2,10}$');
      // AST-based converter cannot parse regex patterns as XPath
      expect(result).toBe('');
    });
  });

  describe('regexMatch function extraction', () => {
    test('returns regexMatch for supported regex patterns', async () => {
      const result = await convertConstraint('regexMatch("^[A-Z][a-z]+$", .)');
      expect(result).toBe(`regexMatch('^[A-Z][a-z]+$', self)`);
    });

    test('returns regexMatch for complex regex patterns', async () => {
      const result = await convertConstraint('regexMatch("^[0-9]{5}$", .)');
      expect(result).toBe(`regexMatch('^[0-9]{5}$', self)`);
    });

    test('returns empty for regexMatch with different argument order', async () => {
      const result = await convertConstraint('regexMatch(., "^[A-Z][a-z]+$")');
      // AST-based converter doesn't support regexMatch function
      expect(result).toBe('');
    });
  });

  describe('unsupported constraint patterns', () => {
    test('returns empty for unsupported patterns', async () => {
      const result = await convertConstraint('${field} > 18');
      expect(result).toBe('field > 18'); // New transpiler converts field references
    });

    test('returns empty for complex expressions', async () => {
      const result = await convertConstraint(
        '${age} > 18 and ${consent} = "yes"',
      );
      expect(result).toBe('age > 18 and consent == "yes"'); // New transpiler converts complex expressions
    });

    test('returns empty for function calls', async () => {
      const result = await convertConstraint('count(${items}) > 0');
      expect(result).toBe('count(items) > 0'); // New transpiler converts function calls
    });
  });

  describe('edge cases', () => {
    test('handles constraint with today() function', async () => {
      const result = await convertConstraint('. > today()');
      // AST-based converter converts date functions to expressions
      expect(result).toBe('self > today()');
    });

    test('handles constraint with now() function', async () => {
      const result = await convertConstraint('. > now()');
      // AST-based converter converts date functions to expressions
      expect(result).toBe('self > now()');
    });

    test('handles constraint with string comparison', async () => {
      const result = await convertConstraint('. = "yes"');
      // AST-based converter converts string comparisons
      expect(result).toBe('self == "yes"');
    });

    test('handles constraint with boolean logic', async () => {
      const result = await convertConstraint('. > 18 and . < 100');
      // AST-based converter converts boolean logic
      expect(result).toBe('self > 18 and self < 100');
    });
  });
});
