import { describe, test, expect } from 'vitest';
import {
  convertConstraint,
  convertRelevance,
  xpathToLimeSurvey,
} from '../../../../src/pipelines/xlsform2lstsv/xpathTranspiler';

describe('XPath Operator Conversion', () => {
  describe('comparison operators', () => {
    test('converts equality operator', async () => {
      const result = await xpathToLimeSurvey("${gender} = 'female'");
      expect(result).toBe("gender == 'female'");
    });

    test('converts inequality operator', async () => {
      const result = await xpathToLimeSurvey("${gender} != 'male'");
      expect(result).toBe("gender != 'male'");
    });

    test('converts less than operator', async () => {
      const result = await xpathToLimeSurvey('${age} < 18');
      expect(result).toBe('age < 18');
    });

    test('converts less than or equal operator', async () => {
      const result = await xpathToLimeSurvey('${age} <= 18');
      expect(result).toBe('age <= 18');
    });

    test('converts greater than operator', async () => {
      const result = await xpathToLimeSurvey('${age} > 18');
      expect(result).toBe('age > 18');
    });

    test('converts greater than or equal operator', async () => {
      const result = await xpathToLimeSurvey('${age} >= 18');
      expect(result).toBe('age >= 18');
    });
  });

  describe('boolean operators', () => {
    test('converts lowercase "and" operator', async () => {
      const result = await xpathToLimeSurvey(
        '${age} > 18 and ${consent} = "yes"',
      );
      expect(result).toBe('age > 18 and consent == "yes"');
    });

    test('converts lowercase "or" operator', async () => {
      const result = await xpathToLimeSurvey(
        '${age} < 18 or ${parent} = "yes"',
      );
      expect(result).toBe('age < 18 or parent == "yes"');
    });
  });

  describe('arithmetic operators', () => {
    test('converts addition operator', async () => {
      const result = await xpathToLimeSurvey('${a} + ${b}');
      expect(result).toBe('a + b');
    });

    test('converts subtraction operator', async () => {
      const result = await xpathToLimeSurvey('${a} - ${b}');
      expect(result).toBe('a - b');
    });

    test('converts multiplication operator', async () => {
      const result = await xpathToLimeSurvey('${a} * ${b}');
      expect(result).toBe('a * b');
    });
  });

  describe('operator precedence', () => {
    test('respects operator precedence in arithmetic', async () => {
      const result = await xpathToLimeSurvey('${a} + ${b} * ${c}');
      expect(result).toBe('a + b * c');
    });

    test('respects operator precedence with parentheses', async () => {
      const result = await xpathToLimeSurvey('(${a} + ${b}) * ${c}');
      // Grouping that changes the result must survive into EM.
      expect(result).toBe('(a + b) * c');
    });

    test('respects boolean operator precedence', async () => {
      const result = await xpathToLimeSurvey('${a} and ${b} or ${c}');
      expect(result).toBe('a and b or c');
    });
  });
});
