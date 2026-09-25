import { describe, test, expect } from 'vitest';
import {
  convertAndParse,
  findRowByName,
  findRowsByClass,
  createChoices,
} from '../helpers';

describe('Select One Question Type', () => {
  test('converts basic select_one question', async () => {
    const survey = [
      { type: 'select_one yesno', name: 'agree', label: 'Do you agree?' },
    ];

    const choices = createChoices('yesno', [
      { name: 'yes', label: 'Yes' },
      { name: 'no', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'agree');

    expect(question?.class).toBe('Q');
    expect(question?.['type/scale']).toBe('L'); // List radio in LimeSurvey
  });

  test('creates answer options for select_one', async () => {
    const survey = [
      { type: 'select_one colors', name: 'color', label: 'Favorite color?' },
    ];

    const choices = createChoices('colors', [
      { name: 'red', label: 'Red' },
      { name: 'blue', label: 'Blue' },
      { name: 'green', label: 'Green' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const answers = findRowsByClass(rows, 'A');

    expect(answers.length).toBeGreaterThanOrEqual(3);
    expect(answers.map((a) => a.name)).toContain('red');
    expect(answers.map((a) => a.name)).toContain('blue');
    expect(answers.map((a) => a.name)).toContain('green');
  });

  test('converts select_one with or_other', async () => {
    const survey = [
      { type: 'select_one yesno or_other', name: 'cho', label: 'Choose' },
    ];

    const choices = createChoices('yesno', [
      { name: 'yes', label: 'Yes' },
      { name: 'no', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'cho');

    expect(question?.other).toBe('Y');
  });

  test('handles select_one with required', async () => {
    const survey = [
      {
        type: 'select_one yesno',
        name: 'reqcho',
        label: 'Make a choice',
        required: 'yes',
      },
    ];

    const choices = createChoices('yesno', [
      { name: 'yes', label: 'Yes' },
      { name: 'no', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'reqcho');

    expect(question?.mandatory).toBe('Y');
  });

  test('rejects a choice list with no rows (#41)', async () => {
    const survey = [
      { type: 'select_one missing_list', name: 'q1', label: 'Question' },
    ];

    // Without choices LimeSurvey would get a question nobody can answer.
    await expect(convertAndParse(survey, [])).rejects.toMatchObject({
      code: 'choice-list-empty',
      message: expect.stringContaining('list "missing_list" has no rows'),
    });
  });

  test('converts select_one with relevance', async () => {
    const survey = [
      { type: 'select_one yesno', name: 'mar', label: 'Are you married?' },
      {
        type: 'text',
        name: 'spous',
        label: 'Spouse name',
        relevant: "selected(${married}, 'yes')",
      },
    ];

    const choices = createChoices('yesno', [
      { name: 'yes', label: 'Yes' },
      { name: 'no', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const spouseQuestion = findRowByName(rows, 'spous');

    expect(spouseQuestion?.relevance).toContain('married'); // Underscores removed
    expect(spouseQuestion?.relevance).toContain('==');
    expect(spouseQuestion?.relevance).toContain('yes');
  });

  test('converts select_one with hint', async () => {
    const survey = [
      {
        type: 'select_one options',
        name: 'opt',
        label: 'Select an option',
        hint: 'Choose the best option',
      },
    ];

    const choices = createChoices('options', [
      { name: 'opt1', label: 'Option 1' },
      { name: 'opt2', label: 'Option 2' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'opt');

    expect(question?.help).toBe('Choose the best option');
  });

  test('handles select_one with required', async () => {
    const survey = [
      {
        type: 'select_one yesno',
        name: 'reqcho',
        label: 'Make a choice',
        required: 'yes',
      },
    ];

    const choices = createChoices('yesno', [
      { name: 'yes', label: 'Yes' },
      { name: 'no', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'reqcho');

    expect(question?.mandatory).toBe('Y');
  });

  test('rejects a choice list with no rows (#41)', async () => {
    const survey = [
      { type: 'select_one missing_list', name: 'q1', label: 'Question' },
    ];

    // Without choices LimeSurvey would get a question nobody can answer.
    await expect(convertAndParse(survey, [])).rejects.toMatchObject({
      code: 'choice-list-empty',
      message: expect.stringContaining('list "missing_list" has no rows'),
    });
  });

  test('converts select_one with relevance', async () => {
    const survey = [
      { type: 'select_one yesno', name: 'mar', label: 'Are you married?' },
      {
        type: 'text',
        name: 'spous',
        label: 'Spouse name',
        relevant: "selected(${married}, 'yes')",
      },
    ];

    const choices = createChoices('yesno', [
      { name: 'yes', label: 'Yes' },
      { name: 'no', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const spouseQuestion = findRowByName(rows, 'spous');

    expect(spouseQuestion?.relevance).toContain('married'); // Underscores removed
    expect(spouseQuestion?.relevance).toContain('==');
    expect(spouseQuestion?.relevance).toContain('yes');
  });

  describe('choice filters', () => {
    test('handles choice filters in relevance', async () => {
      const survey = [
        { type: 'select_one countries', name: 'cnt', label: 'Country' },
        { type: 'select_one cities', name: 'city', label: 'City' },
      ];

      const choices = [
        ...createChoices('countries', [
          { name: 'usa', label: 'USA' },
          { name: 'can', label: 'Canada' },
        ]),
        { list_name: 'cities', name: 'nyc', label: 'New York', filter: 'usa' },
        {
          list_name: 'cities',
          name: 'la',
          label: 'Los Angeles',
          filter: 'usa',
        },
        { list_name: 'cities', name: 'tor', label: 'Toronto', filter: 'can' },
      ];

      const rows = await convertAndParse(survey, choices);
      const nycAnswer = findRowByName(rows, 'nyc');
      const torontoAnswer = findRowByName(rows, 'tor');

      expect(nycAnswer?.relevance).toBeTruthy();
      expect(torontoAnswer?.relevance).toBeTruthy();
    });
  });
});
