import { describe, test, expect } from 'vitest';
import { xpathToLimeSurvey } from '../../pipelines/xlsform2lstsv/xpathTranspiler';

describe('AST parsing', () => {
  test('should parse simple xpath expressions', async () => {
    const xpathExpr = 'concat(b, c)';
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe('b + c');
  });

  test('should parse count function', async () => {
    const xpathExpr = 'count(a)';
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe('count(a)');
  });

  test('should parse comparison expressions', async () => {
    const xpathExpr = '. <= 150';
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe('self <= 150');
  });

  test('should parse greater than or equal comparison', async () => {
    const xpathExpr = '. >= 18';
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe('self >= 18');
  });

  test('should parse equality comparison', async () => {
    const xpathExpr = "a = 'yes'";
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe("a == 'yes'");
  });

  test('should parse complex boolean expressions', async () => {
    const xpathExpr = '. > 20 and . < 200';
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe('self > 20 and self < 200');
  });

  test('should parse regex function', async () => {
    const xpathExpr = 'regex(., "\\p{L}+")';
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe('regexMatch(self, "\\p{L}+")');
  });

  test('should parse contains function', async () => {
    const xpathExpr = 'contains(., "prohibited")';
    const limeSurveyExpr = await xpathToLimeSurvey(xpathExpr);

    console.log(limeSurveyExpr);
    expect(limeSurveyExpr).toBe('contains(self, "prohibited")');
  });
});
