import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName, findRowsByClass } from '../helpers';

describe('Note Question Type', () => {
  test('converts note to boilerplate text', async () => {
    const survey = [
      { type: 'note', name: 'intro', label: 'Welcome to the survey!' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'intro');

    expect(question).toBeDefined();
    expect(question?.class).toBe('Q');
    expect(question?.['type/scale']).toBe('X'); // Boilerplate in LimeSurvey
    expect(question?.text).toBe('Welcome to the survey!');
  });

  test('auto-generates name for note without name', async () => {
    const survey = [{ type: 'note', label: 'Important information' }];

    const rows = await convertAndParse(survey);
    const notes = findRowsByClass(rows, 'Q').filter(
      (q) => q['type/scale'] === 'X',
    );

    expect(notes.length).toBeGreaterThan(0);
    expect(notes[notes.length - 1].name).toMatch(/^Q\d+$/);
  });

  test('converts note with hint', async () => {
    const survey = [
      { type: 'note', name: 'n1', label: 'Note', hint: 'Additional help' },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'n1');

    expect(question?.help).toBe('Additional help');
  });

  test('converts note with relevance', async () => {
    const survey = [
      { type: 'text', name: 'q1', label: 'Question 1' },
      {
        type: 'note',
        name: 'cond',
        label: 'This appears conditionally',
        relevant: '${q1} != ""',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'cond');

    expect(question?.relevance).toContain('q1'); // Underscores removed
  });

  test('converts note with long text', async () => {
    const survey = [
      {
        type: 'note',
        name: 'info',
        label:
          'This is a very long note with multiple lines and detailed information that should be displayed to the user.',
      },
    ];

    const rows = await convertAndParse(survey);
    const question = findRowByName(rows, 'info');

    expect(question?.text).toBe(
      'This is a very long note with multiple lines and detailed information that should be displayed to the user.',
    );
  });
});
