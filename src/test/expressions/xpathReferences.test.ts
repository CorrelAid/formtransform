import { describe, test, expect } from 'vitest';
import {
  convertConstraint,
  convertRelevance,
  xpathToLimeSurvey,
} from '../../pipelines/xlsform2lstsv/xpathTranspiler';

describe('XPath Reference Conversion', () => {
  describe('field references', () => {
    test('converts basic field reference', async () => {
      const result = await xpathToLimeSurvey('${age} > 18');
      expect(result).toBe('age > 18');
    });

    test('converts multiple field references', async () => {
      const result = await xpathToLimeSurvey('${age} > ${min_age}');
      expect(result).toBe('age > minage');
    });

    test('converts field reference with underscores', async () => {
      const result = await xpathToLimeSurvey('${first_name} = "John"');
      expect(result).toBe('firstname == "John"');
    });

    test('converts field reference in function', async () => {
      const result = await xpathToLimeSurvey('count(${items}) > 0');
      expect(result).toBe('count(items) > 0');
    });
  });

  describe('current field references', () => {
    test('converts current field reference at start', async () => {
      const result = await xpathToLimeSurvey('. > 18');
      expect(result).toBe('self > 18');
    });

    test('converts current field reference followed by space', async () => {
      const result = await xpathToLimeSurvey('. >= 18');
      expect(result).toBe('self >= 18');
    });

    test('converts current field reference in comparison', async () => {
      const result = await xpathToLimeSurvey('. = "yes"');
      expect(result).toBe('self == "yes"');
    });

    test('converts current field reference in function', async () => {
      const result = await xpathToLimeSurvey('string-length(.) > 5');
      expect(result).toBe('strlen(self) > 5');
    });

    test('converts multiple current field references', async () => {
      const result = await xpathToLimeSurvey('. > 18 and . < 100');
      expect(result).toBe('self > 18 and self < 100');
    });
  });

  describe('literal values', () => {
    test('converts string literals', async () => {
      const result = await xpathToLimeSurvey("${gender} = 'female'");
      expect(result).toBe("gender == 'female'");
    });

    test('converts numeric literals', async () => {
      const result = await xpathToLimeSurvey('${age} > 18');
      expect(result).toBe('age > 18');
    });

    test('converts mixed literals', async () => {
      const result = await xpathToLimeSurvey(
        "${status} = 'active' and ${count} > 0",
      );
      expect(result).toBe("status == 'active' and count > 0");
    });
  });

  describe('complex expressions with references', () => {
    test('converts complex expression with field references', async () => {
      const result = await xpathToLimeSurvey(
        '${age} > 18 and ${consent} = "yes" and ${parent} = "no"',
      );
      expect(result).toBe('age > 18 and consent == "yes" and parent == "no"');
    });

    test('converts expression with mixed references', async () => {
      const result = await xpathToLimeSurvey('${age} > 18 and . = "yes"');
      expect(result).toBe('age > 18 and self == "yes"');
    });

    test('converts expression with functions and references', async () => {
      const result = await xpathToLimeSurvey(
        'count(${items}) > 0 and ${status} = "active"',
      );
      expect(result).toBe('count(items) > 0 and status == "active"');
    });
  });

  describe('edge cases in references', () => {
    test('handles field names that are XPath keywords', async () => {
      const result = await xpathToLimeSurvey('${and} > 0');
      expect(result).toBe('and > 0');
    });

    test('handles field names with numbers', async () => {
      const result = await xpathToLimeSurvey('${field123} = "value"');
      expect(result).toBe('field123 == "value"');
    });
  });
});
