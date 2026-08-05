import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName } from '../helpers';

describe('Time Question Type', () => {
  test('converts basic time question', async () => {
    const survey = [{ type: 'time', name: 'meet', label: 'Meeting time' }];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'meet');

    expect(question).toBeDefined();
    expect(question?.class).toBe('Q');
    // LimeSurvey doesn't have time-only, maps to date
    expect(question?.['type/scale']).toBe('D');
    expect(question?.text).toBe('Meeting time');
  });

  test('converts required time question', async () => {
    const survey = [
      { type: 'time', name: 'start', label: 'Start time', required: 'yes' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'start');

    expect(question?.mandatory).toBe('Y');
  });

  test('converts time question with default value', async () => {
    const survey = [
      { type: 'time', name: 'def', label: 'Default time', default: '09:00:00' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'def');

    expect(question?.default).toBe('09:00:00');
  });

  test('converts time question with relevance', async () => {
    const survey = [
      {
        type: 'select_one yesno',
        name: 'hastime',
        label: 'Do you have a time?',
      },
      {
        type: 'time',
        name: 'thetime',
        label: 'Enter time',
        relevant: "${has_time} = 'yes'",
      },
    ];

    const choices = [
      { list_name: 'yesno', name: 'yes', label: 'Yes' },
      { list_name: 'yesno', name: 'no', label: 'No' },
    ];

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'thetime');

    expect(question?.relevance).toContain('hastime'); // Underscores removed
  });

  test('converts time question with hint', async () => {
    const survey = [
      {
        type: 'time',
        name: 'event',
        label: 'Event time',
        hint: 'Format: HH:MM:SS',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'event');

    expect(question?.help).toBe('Format: HH:MM:SS');
  });
});
