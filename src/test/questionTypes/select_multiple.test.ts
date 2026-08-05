import { describe, test, expect } from 'vitest';
import {
  convertAndParse,
  findRowByName,
  findRowsByClass,
  createChoices,
} from '../helpers';

describe('Select Multiple Question Type', () => {
  test('converts basic select_multiple question', async () => {
    const survey = [
      {
        type: 'select_multiple interests',
        name: 'hob',
        label: 'What are your hobbies?',
      },
    ];

    const choices = createChoices('interests', [
      { name: 'sport', label: 'Sports' },
      { name: 'music', label: 'Music' },
      { name: 'read', label: 'Reading' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'hob');

    expect(question?.class).toBe('Q');
    expect(question?.['type/scale']).toBe('M'); // Multiple choice in LimeSurvey
  });

  test('creates subquestions for select_multiple', async () => {
    const survey = [
      {
        type: 'select_multiple pets',
        name: 'anim',
        label: 'Which pets do you have?',
      },
    ];

    const choices = createChoices('pets', [
      { name: 'dog', label: 'Dog' },
      { name: 'cat', label: 'Cat' },
      { name: 'fish', label: 'Fish' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const subquestions = findRowsByClass(rows, 'SQ');

    expect(subquestions.length).toBeGreaterThanOrEqual(3);
    expect(subquestions.map((sq) => sq.name)).toContain('dog');
    expect(subquestions.map((sq) => sq.name)).toContain('cat');
    expect(subquestions.map((sq) => sq.name)).toContain('fish');
  });

  test('converts select_multiple with or_other', async () => {
    const survey = [
      {
        type: 'select_multiple items or_other',
        name: 'stuff',
        label: 'Select items',
      },
    ];

    const choices = createChoices('items', [
      { name: 'item1', label: 'Item 1' },
      { name: 'item2', label: 'Item 2' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'stuff');

    expect(question?.other).toBe('Y');
  });

  test('handles auto-generated subquestion names', async () => {
    const survey = [
      { type: 'select_multiple list1', name: 'q1', label: 'Question' },
    ];

    const choices = [
      { list_name: 'list1', label: 'Choice 1' }, // No name
      { list_name: 'list1', label: 'Choice 2' }, // No name
    ];

    const rows = await convertAndParse(survey, choices);
    const subquestions = findRowsByClass(rows, 'SQ');

    // Should have auto-generated names like SQ0, SQ1
    expect(subquestions.length).toBe(2);
    expect(subquestions.some((sq) => sq.name.match(/^SQ\d+$/))).toBe(true);
  });

  test('converts select_multiple with required', async () => {
    const survey = [
      {
        type: 'select_multiple options',
        name: 'reqmul',
        label: 'Select options',
        required: 'yes',
      },
    ];

    const choices = createChoices('options', [
      { name: 'opt1', label: 'Option 1' },
      { name: 'opt2', label: 'Option 2' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'reqmul');

    expect(question?.mandatory).toBe('Y');
  });

  test('converts select_multiple with hint', async () => {
    const survey = [
      {
        type: 'select_multiple colors',
        name: 'cols',
        label: 'Select colors',
        hint: 'Choose all that apply',
      },
    ];

    const choices = createChoices('colors', [
      { name: 'red', label: 'Red' },
      { name: 'blue', label: 'Blue' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'cols');

    expect(question?.help).toBe('Choose all that apply');
  });

  test('converts select_multiple with relevance', async () => {
    const survey = [
      { type: 'select_one yesno', name: 'haspets', label: 'Do you have pets?' },
      {
        type: 'select_multiple pets',
        name: 'pets',
        label: 'Which pets?',
        relevant: "${has_pets} = 'yes'",
      },
    ];

    const choices = [
      ...createChoices('yesno', [
        { name: 'yes', label: 'Yes' },
        { name: 'no', label: 'No' },
      ]),
      ...createChoices('pets', [
        { name: 'dog', label: 'Dog' },
        { name: 'cat', label: 'Cat' },
      ]),
    ];

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'pets');

    expect(question?.relevance).toContain('haspets'); // Underscores removed
  });

  test('handles auto-generated subquestion names', async () => {
    const survey = [
      { type: 'select_multiple list1', name: 'q1', label: 'Question' },
    ];

    const choices = [
      { list_name: 'list1', label: 'Choice 1' }, // No name
      { list_name: 'list1', label: 'Choice 2' }, // No name
    ];

    const rows = await convertAndParse(survey, choices);
    const subquestions = findRowsByClass(rows, 'SQ');

    // Should have auto-generated names like SQ0, SQ1
    expect(subquestions.length).toBe(2);
    expect(subquestions.some((sq) => sq.name.match(/^SQ\d+$/))).toBe(true);
  });

  test('converts select_multiple with required', async () => {
    const survey = [
      {
        type: 'select_multiple options',
        name: 'reqmul',
        label: 'Select options',
        required: 'yes',
      },
    ];

    const choices = createChoices('options', [
      { name: 'opt1', label: 'Option 1' },
      { name: 'opt2', label: 'Option 2' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const question = findRowByName(rows, 'reqmul');

    expect(question?.mandatory).toBe('Y');
  });
});
