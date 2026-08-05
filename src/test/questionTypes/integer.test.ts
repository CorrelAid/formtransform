import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName } from '../helpers';

describe('Integer Question Type', () => {
  test('converts basic integer question', async () => {
    const survey = [
      { type: 'integer', name: 'age', label: 'How old are you?' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'age');

    expect(question).toBeDefined();
    expect(question?.class).toBe('Q');
    expect(question?.['type/scale']).toBe('N'); // Numeric in LimeSurvey
    expect(question?.text).toBe('How old are you?');
  });

  test('converts int type as numeric', async () => {
    const survey = [{ type: 'int', name: 'count', label: 'Count' }];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'count');

    expect(question?.['type/scale']).toBe('N');
  });

  test('converts required integer question', async () => {
    const survey = [
      { type: 'integer', name: 'year', label: 'Birth year', required: 'true' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'year');

    expect(question?.mandatory).toBe('Y');
  });

  test('converts integer question with constraint', async () => {
    const survey = [
      {
        type: 'integer',
        name: 'age',
        label: 'Age',
        constraint: '. >= 18 and . <= 100',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'age');

    // AST-based converter returns LimeSurvey expressions for numeric ranges
    expect(question?.em_validation_q).toBe('self >= 18 and self <= 100');
  });

  test('converts integer question with default value', async () => {
    const survey = [
      { type: 'integer', name: 'qty', label: 'Quantity', default: '1' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'qty');

    expect(question?.default).toBe('1');
  });

  test('converts integer question with relevance based on another numeric', async () => {
    const survey = [
      { type: 'integer', name: 'inc', label: 'Annual income' },
      {
        type: 'integer',
        name: 'tax',
        label: 'Tax paid',
        relevant: '${income} > 0',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'tax');

    expect(question?.relevance).toContain('income');
    expect(question?.relevance).toContain('>');
  });

  test('handles integer question with hint', async () => {
    const survey = [
      {
        type: 'integer',
        name: 'score',
        label: 'Score',
        hint: 'Enter a number between 0-100',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'score');

    expect(question?.help).toBe('Enter a number between 0-100');
  });
});
