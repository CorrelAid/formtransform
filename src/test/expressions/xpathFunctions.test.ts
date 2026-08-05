import { describe, test, expect } from 'vitest';
import {
  convertConstraint,
  convertRelevance,
  xpathToLimeSurvey,
  TranspilerContext,
} from '../../pipelines/xlsform2lstsv/xpathTranspiler';

describe('XPath Function Conversion', () => {
  describe('selected() function', () => {
    test('converts selected() with single quotes', async () => {
      const result = await xpathToLimeSurvey("selected(${gender}, 'female')");
      expect(result).toBe('(gender=="female")');
    });

    test('converts selected() with double quotes', async () => {
      const result = await xpathToLimeSurvey('selected(${gender}, "female")');
      expect(result).toBe('(gender=="female")');
    });

    test('converts selected() without spaces', async () => {
      const result = await xpathToLimeSurvey("selected(${consent},'yes')");
      expect(result).toBe('(consent=="yes")');
    });

    test('converts selected() with spaces', async () => {
      const result = await xpathToLimeSurvey("selected( ${consent} , 'yes' )");
      expect(result).toBe('(consent=="yes")');
    });
  });

  describe('regex() function', () => {
    test('converts regex() with field reference', async () => {
      const result = await xpathToLimeSurvey('regex(${name}, "^[A-Z][a-z]+$")');
      expect(result).toBe('regexMatch(name, "^[A-Z][a-z]+$")');
    });

    test('converts regex() with current field', async () => {
      const result = await xpathToLimeSurvey('regex(., "^[A-Z][a-z]+$")');
      expect(result).toBe('regexMatch(self, "^[A-Z][a-z]+$")');
    });
  });

  describe('count() function', () => {
    test('converts count() function', async () => {
      const result = await xpathToLimeSurvey('count(${items}) > 0');
      expect(result).toBe('count(items) > 0');
    });
  });

  describe('concat() function', () => {
    test('converts concat() function', async () => {
      const result = await xpathToLimeSurvey("concat(${first}, ' ', ${last})");
      expect(result).toBe("first + ' ' + last");
    });
  });

  describe('contains() function', () => {
    test('converts contains() function', async () => {
      const result = await xpathToLimeSurvey("contains(${text}, 'prohibited')");
      expect(result).toBe("contains(text, 'prohibited')");
    });
  });

  describe('string functions', () => {
    test('converts string-length() function', async () => {
      const result = await xpathToLimeSurvey('string-length(${name}) > 5');
      expect(result).toBe('strlen(name) > 5');
    });

    test('converts substring() function', async () => {
      const result = await xpathToLimeSurvey('substring(${code}, 1, 3)');
      expect(result).toBe('substr(code, 1, 3)');
    });

    test('converts starts-with() function', async () => {
      const result = await xpathToLimeSurvey("starts-with(${name}, 'Dr')");
      expect(result).toBe("startsWith(name, 'Dr')");
    });

    test('converts ends-with() function', async () => {
      const result = await xpathToLimeSurvey("ends-with(${name}, 'Jr')");
      expect(result).toBe("endsWith(name, 'Jr')");
    });

    test('converts normalize-space() function', async () => {
      const result = await xpathToLimeSurvey('normalize-space(${name})');
      expect(result).toBe('trim(name)');
    });

    test('converts normalize-space() with concat argument', async () => {
      const result = await xpathToLimeSurvey(
        "normalize-space(concat(${a}, ',', ${b}))",
      );
      expect(result).toBe("trim(a + ',' + b)");
    });
  });

  describe('number functions', () => {
    test('converts floor() function', async () => {
      const result = await xpathToLimeSurvey('floor(${value})');
      expect(result).toBe('floor(value)');
    });

    test('converts ceiling() function', async () => {
      const result = await xpathToLimeSurvey('ceiling(${value})');
      expect(result).toBe('ceil(value)');
    });

    test('converts round() function', async () => {
      const result = await xpathToLimeSurvey('round(${value})');
      expect(result).toBe('round(value)');
    });

    test('converts sum() function', async () => {
      const result = await xpathToLimeSurvey('sum(${values})');
      expect(result).toBe('sum(values)');
    });
  });

  describe('math functions', () => {
    test('converts basic arithmetic', async () => {
      const result = await xpathToLimeSurvey('${a} + ${b} * ${c}');
      expect(result).toBe('a + b * c');
    });
  });

  describe('date functions', () => {
    test('converts today() function', async () => {
      const result = await xpathToLimeSurvey('${date} > today()');
      expect(result).toBe('date > today()');
    });

    test('converts now() function', async () => {
      const result = await xpathToLimeSurvey('${time} > now()');
      expect(result).toBe('time > now()');
    });
  });

  describe('logical functions', () => {
    test('converts not() function', async () => {
      const result = await xpathToLimeSurvey('not(${consent})');
      expect(result).toBe('!(consent)');
    });
  });

  describe('conditional functions', () => {
    test('converts if() function to if()', async () => {
      const result = await xpathToLimeSurvey(
        'if(${age} > 18, "adult", "minor")',
      );
      expect(result).toBe('if(age > 18, "adult", "minor")');
    });
  });

  describe('selected() with TranspilerContext', () => {
    // These tests verify that when a TranspilerContext is provided,
    // selected() uses buildSelectedExpr to generate type-aware expressions.
    // Without these, the bug where select_multiple generated (field=="code")
    // instead of (field_code.NAOK == "Y") went undetected.

    test('select_multiple: selected() produces field_code.NAOK == "Y"', async () => {
      const ctx: TranspilerContext = {
        buildSelectedExpr: (field, value) => `(${field}_${value}.NAOK == "Y")`,
      };
      const result = await xpathToLimeSurvey(
        "selected(${project_id}, 'alpha')",
        ctx,
      );
      expect(result).toBe('(projectid_alpha.NAOK == "Y")');
    });

    test('select_one: selected() produces field.NAOK=="code"', async () => {
      const ctx: TranspilerContext = {
        buildSelectedExpr: (field, value) => `(${field}.NAOK=="${value}")`,
      };
      const result = await xpathToLimeSurvey(
        "selected(${gender}, 'female')",
        ctx,
      );
      expect(result).toBe('(gender.NAOK=="female")');
    });

    test('buildSelectedExpr receives sanitized field name (hyphens/underscores removed)', async () => {
      const ctx: TranspilerContext = {
        buildSelectedExpr: (field, value) => `(${field}_${value}.NAOK == "Y")`,
      };
      const result = await xpathToLimeSurvey(
        "selected(${my_field-name}, 'val')",
        ctx,
      );
      expect(result).toBe('(myfieldname_val.NAOK == "Y")');
    });

    test('without context, selected() falls back to basic equality', async () => {
      const result = await xpathToLimeSurvey("selected(${field}, 'value')");
      expect(result).toBe('(field=="value")');
    });
  });

  describe('equality with lookupAnswerCode', () => {
    // These tests verify that = / != comparisons rewrite choice values
    // via lookupAnswerCode. Without these, the bug where relevance used
    // unsanitized choice values (e.g., 'not_successful' instead of 'notsu')
    // went undetected.

    test('rewrites choice value in equality comparison', async () => {
      const ctx: TranspilerContext = {
        lookupAnswerCode: (_field, value) => {
          if (value === 'not_successful') return 'notsu';
          return value;
        },
      };
      const result = await convertRelevance(
        "${past_applications} = 'not_successful'",
        ctx,
      );
      expect(result).toBe("pastapplications == 'notsu'");
    });

    test('rewrites choice value in != comparison', async () => {
      const ctx: TranspilerContext = {
        lookupAnswerCode: (_field, value) => {
          if (value === 'option-one') return 'optio';
          return value;
        },
      };
      const result = await convertRelevance("${question} != 'option-one'", ctx);
      expect(result).toBe("question != 'optio'");
    });

    test('does not alter expression when lookup returns same value', async () => {
      const ctx: TranspilerContext = {
        lookupAnswerCode: (_field, value) => value,
      };
      const result = await convertRelevance("${field} != ''", ctx);
      expect(result).toBe("field != ''");
    });

    test('combined: selected() with buildSelectedExpr and equality with lookupAnswerCode', async () => {
      const ctx: TranspilerContext = {
        buildSelectedExpr: (field, value) => `(${field}_${value}.NAOK == "Y")`,
        lookupAnswerCode: (_field, value) => {
          if (value === 'yes') return 'yes';
          return value;
        },
      };
      const result = await convertRelevance(
        "selected(${multi_q}, 'opt1') and ${single_q} = 'yes'",
        ctx,
      );
      expect(result).toContain('(multiq_opt1.NAOK == "Y")');
      expect(result).toContain(' and ');
      expect(result).toContain("singleq == 'yes'");
    });
  });
});
