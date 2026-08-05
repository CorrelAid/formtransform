import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName } from '../helpers';

describe('Decimal Question Type', () => {
  test('converts basic decimal question', async () => {
    const survey = [{ type: 'decimal', name: 'price', label: 'Enter price' }];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'price');

    expect(question).toBeDefined();
    expect(question?.class).toBe('Q');
    expect(question?.['type/scale']).toBe('N'); // Numeric in LimeSurvey
    expect(question?.text).toBe('Enter price');
  });

  test('converts required decimal question', async () => {
    const survey = [
      { type: 'decimal', name: 'gpa', label: 'GPA', required: 'yes' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'gpa');

    expect(question?.mandatory).toBe('Y');
  });

  test('converts decimal question with constraint', async () => {
    const survey = [
      {
        type: 'decimal',
        name: 'score',
        label: 'Score',
        constraint: '. >= 0 and . <= 100',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'score');

    // AST-based converter returns LimeSurvey expressions for numeric ranges
    expect(question?.em_validation_q).toBe('self >= 0 and self <= 100');
  });

  test('converts decimal question with default value', async () => {
    const survey = [
      { type: 'decimal', name: 'rate', label: 'Rate', default: '3.5' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'rate');

    expect(question?.default).toBe('3.5');
  });

  test('handles decimal question with hint', async () => {
    const survey = [
      {
        type: 'decimal',
        name: 'gpa',
        label: 'GPA',
        hint: 'Enter as decimal (e.g., 3.75)',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'gpa');

    expect(question?.help).toBe('Enter as decimal (e.g., 3.75)');
  });

  test('converts decimal question with relevance', async () => {
    const survey = [
      { type: 'integer', name: 'total', label: 'Total amount' },
      {
        type: 'decimal',
        name: 'percent',
        label: 'Percentage',
        relevant: '${total} > 0',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'percent');

    expect(question?.relevance).toContain('total');
    expect(question?.relevance).toContain('>');
  });
});
