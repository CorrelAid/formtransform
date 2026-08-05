import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName } from '../helpers';

describe('Date Question Type', () => {
  test('converts basic date question', async () => {
    const survey = [{ type: 'date', name: 'birth', label: 'Date of birth' }];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'birth');

    expect(question).toBeDefined();
    expect(question?.class).toBe('Q');
    expect(question?.['type/scale']).toBe('D'); // Date in LimeSurvey
    expect(question?.text).toBe('Date of birth');
  });

  test('converts required date question', async () => {
    const survey = [
      { type: 'date', name: 'start', label: 'Start date', required: 'yes' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'start');

    expect(question?.mandatory).toBe('Y');
  });

  test('converts date question with constraint', async () => {
    const survey = [
      {
        type: 'date',
        name: 'future',
        label: 'Future date',
        constraint: '. > today()',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'future');

    // AST-based converter converts date constraints to expressions
    expect(question?.em_validation_q).toBe('self > today()');
  });

  test('converts date question with default value', async () => {
    const survey = [
      { type: 'date', name: 'defdate', label: 'Date', default: 'today()' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'defdate');

    expect(question?.default).toBe('today()');
  });

  test('converts date question with relevance', async () => {
    const survey = [
      {
        type: 'select_one yesno',
        name: 'hasdate',
        label: 'Do you have a date?',
      },
      {
        type: 'date',
        name: 'thedate',
        label: 'Enter date',
        relevant: "${has_date} = 'yes'",
      },
    ];

    const choices = [
      { list_name: 'yesno', name: 'yes', label: 'Yes' },
      { list_name: 'yesno', name: 'no', label: 'No' },
    ];

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'thedate');

    expect(question?.relevance).toContain('hasdate'); // Underscores removed
  });

  test('converts date question with hint', async () => {
    const survey = [
      {
        type: 'date',
        name: 'event',
        label: 'Event date',
        hint: 'Format: YYYY-MM-DD',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'event');

    expect(question?.help).toBe('Format: YYYY-MM-DD');
  });
});
