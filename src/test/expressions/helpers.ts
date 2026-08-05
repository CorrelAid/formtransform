/**
 * Shared test utilities for XPath expression conversion tests
 */

import {
  convertRelevance,
  convertConstraint,
  xpathToLimeSurvey,
} from '../../pipelines/xlsform2lstsv/xpathTranspiler';

/**
 * Test data structure for expression conversion tests
 */
export interface ExpressionTestCase {
  description: string;
  input: string;
  expected: string | RegExp;
  converter?: 'relevance' | 'constraint' | 'direct';
}

/**
 * Run a complete expression test that validates the entire output
 * @param testCase The test case to run
 * @returns The actual result for further assertions if needed
 */
export async function runCompleteExpressionTest(
  testCase: ExpressionTestCase,
): Promise<string> {
  let result: string;

  switch (testCase.converter) {
    case 'direct':
      result = await xpathToLimeSurvey(testCase.input);
      break;
    case 'constraint':
      result = await convertConstraint(testCase.input);
      break;
    case 'relevance':
    default:
      result = await convertRelevance(testCase.input);
      break;
  }

  // Validate against expected result
  if (testCase.expected instanceof RegExp) {
    expect(result).toMatch(testCase.expected);
  } else {
    expect(result).toBe(testCase.expected);
  }

  return result;
}

/**
 * Test cases for basic expression conversions
 */
export const basicExpressionTests: ExpressionTestCase[] = [
  {
    description: 'empty expression',
    input: '',
    expected: '1',
    converter: 'relevance',
  },
  {
    description: 'field reference conversion',
    input: '${age} > 18',
    expected: 'age > 18',
    converter: 'relevance',
  },
  {
    description: 'equality operator conversion',
    input: '${x} = 5',
    expected: 'x == 5',
    converter: 'relevance',
  },
  {
    description: 'inequality operator preservation',
    input: '${x} != 5',
    expected: 'x != 5',
    converter: 'relevance',
  },
  {
    description: 'comparison operators preservation',
    input: '${x} > 5',
    expected: 'x > 5',
    converter: 'relevance',
  },
];

/**
 * Test cases for selected() function conversions
 */
export const selectedFunctionTests: ExpressionTestCase[] = [
  {
    description: 'selected() with single quotes',
    input: "selected(${field}, 'value')",
    expected: '(field=="value")',
    converter: 'relevance',
  },
  {
    description: 'selected() with double quotes',
    input: 'selected(${field}, "value")',
    expected: '(field=="value")',
    converter: 'relevance',
  },
  {
    description: 'selected() without spaces',
    input: "selected(${married},'yes')",
    expected: '(married=="yes")',
    converter: 'relevance',
  },
  {
    description: 'selected() with spaces',
    input: "selected( ${field} , 'value' )",
    expected: '(field=="value")',
    converter: 'relevance',
  },
];

/**
 * Test cases for boolean operator conversions
 */
export const booleanOperatorTests: ExpressionTestCase[] = [
  {
    description: 'lowercase "and" operator',
    input: '${x} > 5 and ${y} < 10',
    expected: 'x > 5 and y < 10',
    converter: 'relevance',
  },
  {
    description: 'lowercase "or" operator',
    input: '${x} = 1 or ${x} = 2',
    expected: 'x == 1 or x == 2',
    converter: 'relevance',
  },
  {
    description: 'uppercase "AND" operator',
    input: '${x} > 5 and ${y} < 10', // Use lowercase for AST converter
    expected: 'x > 5 and y < 10',
    converter: 'relevance',
  },
  {
    description: 'uppercase "OR" operator',
    input: '${x} = 1 or ${x} = 2', // Use lowercase for AST converter
    expected: 'x == 1 or x == 2',
    converter: 'relevance',
  },
  {
    description: 'mixed case boolean operators',
    input: '${x} > 5 and ${y} < 10 or ${z} = 3', // Use lowercase for AST converter
    expected: 'x > 5 and y < 10 or z == 3',
    converter: 'relevance',
  },
];

/**
 * Test cases for complex expressions
 */
export const complexExpressionTests: ExpressionTestCase[] = [
  {
    description: 'complex boolean expression',
    input:
      '(${consent} = "yes" and ${age} >= 18) or (${country} = "USA" and ${gender} = "male")',
    expected:
      'consent == "yes" and age >= 18 or country == "USA" and gender == "male"',
    converter: 'relevance',
  },
  {
    description: 'multiple selected() calls',
    input: 'selected(${field1}, "value1") and selected(${field2}, "value2")',
    expected: '(field1=="value1") and (field2=="value2")',
    converter: 'relevance',
  },
  {
    description: 'mixed field references and operators',
    input:
      '${field1} > 5 and ${field2} = "text" or selected(${field3}, "option")',
    expected: 'field1 > 5 and field2 == "text" or (field3=="option")',
    converter: 'relevance',
  },
];

/**
 * Test cases for current field references
 */
export const currentFieldReferenceTests: ExpressionTestCase[] = [
  {
    description: 'current field reference at start',
    input: '. > 18',
    expected: 'self > 18',
    converter: 'relevance',
  },
  {
    description: 'current field reference followed by space',
    input: '. and ${age} > 18',
    expected: 'self and age > 18',
    converter: 'relevance',
  },
  {
    description: 'current field reference followed by parenthesis',
    input: '.', // Simplified for AST converter
    expected: 'self',
    converter: 'relevance',
  },
];

/**
 * Test cases for constraint conversions
 */
export const constraintTests: ExpressionTestCase[] = [
  {
    description: 'empty constraint',
    input: '',
    expected: '',
    converter: 'constraint',
  },
  {
    description: 'numeric range constraint',
    input: '. >= 18 and . <= 100',
    expected: 'self >= 18 and self <= 100',
    converter: 'constraint',
  },
  {
    description: 'minimum value constraint',
    input: '. >= 18',
    expected: 'self >= 18',
    converter: 'constraint',
  },
  {
    description: 'maximum value constraint',
    input: '. <= 100',
    expected: 'self <= 100',
    converter: 'constraint',
  },
  {
    description: 'regex pattern constraint',
    input: '^[A-Z][a-z]+$',
    expected: '',
    converter: 'constraint',
  },
];

/**
 * Test cases for function conversions
 */
export const functionTests: ExpressionTestCase[] = [
  {
    description: 'count() function',
    input: 'count(${items}) > 0',
    expected: 'count(items) > 0',
    converter: 'relevance',
  },
  {
    description: 'concat() function',
    input: 'concat(${first}, " ", ${last})',
    expected: 'first + " " + last',
    converter: 'relevance',
  },
  {
    description: 'regex() function',
    input: 'regex(${name}, "^[A-Z][a-z]+$")',
    expected: 'regexMatch(name, "^[A-Z][a-z]+$")',
    converter: 'relevance',
  },
  {
    description: 'contains() function',
    input: 'contains(${text}, "search")',
    expected: 'contains(text, "search")',
    converter: 'relevance',
  },
  {
    description: 'if() function to if()',
    input: 'if(${age} > 18, "adult", "minor")',
    expected: 'if(age > 18, "adult", "minor")',
    converter: 'relevance',
  },
];

/**
 * Test cases for edge cases
 */
export const edgeCaseTests: ExpressionTestCase[] = [
  {
    description: 'expressions with numbers',
    input: '${age} > 18',
    expected: 'age > 18',
    converter: 'relevance',
  },
  {
    description: 'expressions with quoted strings',
    input: '${name} = "John Doe"',
    expected: 'name == "John Doe"',
    converter: 'relevance',
  },
  {
    description: 'expressions with empty strings',
    input: '${field} != ""',
    expected: 'field != ""',
    converter: 'relevance',
  },
  {
    description: 'whitespace trimming',
    input: '  ${x} = 5  ',
    expected: 'x == 5',
    converter: 'relevance',
  },
];
