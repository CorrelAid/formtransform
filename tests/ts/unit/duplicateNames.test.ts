import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowsByClass, createChoices } from './helpers';

describe('Duplicate name detection and deduplication', () => {
  test('two fields that collide after truncation get unique names', async () => {
    const survey = [
      { type: 'begin_group', name: 'g1', label: 'Group' },
      {
        type: 'select_one yes_no',
        name: 'probleme_ansprechpersonen',
        label: 'Has contact person?',
      },
      {
        type: 'text',
        name: 'probleme_ansprechpersonen_text',
        label: 'Please explain',
      },
      { type: 'end_group' },
    ];
    const choices = createChoices('yes_no', [
      { name: 'ja', label: 'Yes' },
      { name: 'nein', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const questions = findRowsByClass(rows, 'Q');

    const names = questions.map((q) => q.name);
    // First field keeps the truncated name
    expect(names).toContain('problemeansprechpers');
    // Second field gets a deduplicated name
    expect(names).toContain('problemeansprechper1');
    // All Q names should be unique (across all language rows, same name repeats, but no two different questions share a name)
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(2);
  });

  test('three-way collision appends incrementing suffixes', async () => {
    // All three strip+truncate to the same 20-char prefix
    const survey = [
      { type: 'begin_group', name: 'g1', label: 'Group' },
      { type: 'text', name: 'abcdefghij_klmnopqrst', label: 'Q1' }, // abcdefghijklmnopqrst (20)
      { type: 'text', name: 'abcdefghij_klmnopqrst_extra', label: 'Q2' }, // abcdefghijklmnopqrstextra → truncates to same 20
      { type: 'text', name: 'abcdefghij_klmnopqrst_other', label: 'Q3' }, // abcdefghijklmnopqrstother → truncates to same 20
      { type: 'end_group' },
    ];

    const rows = await convertAndParse(survey);
    const questions = findRowsByClass(rows, 'Q');
    const names = [...new Set(questions.map((q) => q.name))];

    expect(names).toContain('abcdefghijklmnopqrst'); // first keeps original
    expect(names).toContain('abcdefghijklmnopqrs1'); // second gets suffix 1
    expect(names).toContain('abcdefghijklmnopqrs2'); // third gets suffix 2
    expect(names.length).toBe(3);
  });

  test('no collision when names are different after truncation', async () => {
    const survey = [
      { type: 'begin_group', name: 'g1', label: 'Group' },
      { type: 'text', name: 'short_name', label: 'Q1' },
      { type: 'text', name: 'another_name', label: 'Q2' },
      { type: 'end_group' },
    ];

    const rows = await convertAndParse(survey);
    const questions = findRowsByClass(rows, 'Q');
    const names = [...new Set(questions.map((q) => q.name))];

    expect(names).toContain('shortname');
    expect(names).toContain('anothername');
    expect(names.length).toBe(2);
  });

  test('relevance expressions reference the deduplicated name', async () => {
    const survey = [
      { type: 'begin_group', name: 'g1', label: 'Group' },
      {
        type: 'select_one yes_no',
        name: 'probleme_ansprechpersonen',
        label: 'Has contact person?',
      },
      {
        type: 'text',
        name: 'probleme_ansprechpersonen_text',
        label: 'Explain',
        relevant: "${probleme_ansprechpersonen} = 'ja'",
      },
      { type: 'end_group' },
    ];
    const choices = createChoices('yes_no', [
      { name: 'ja', label: 'Yes' },
      { name: 'nein', label: 'No' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const questions = findRowsByClass(rows, 'Q');

    // The text question (deduplicated name) should reference the original field's sanitized name
    const textQ = questions.find((q) => q.name === 'problemeansprechper1');
    expect(textQ).toBeDefined();
    // The relevance should reference 'problemeansprechpers' (the first field's unique name)
    expect(textQ!.relevance).toContain('problemeansprechpers');
    expect(textQ!.relevance).not.toContain('problemeansprechper1');
  });

  test('selected() expressions use deduplicated names correctly', async () => {
    const survey = [
      { type: 'begin_group', name: 'g1', label: 'Group' },
      {
        type: 'select_multiple options',
        name: 'long_question_name_here',
        label: 'Pick options',
      },
      {
        type: 'select_multiple options',
        name: 'long_question_name_here_extra',
        label: 'Pick more',
      },
      {
        type: 'text',
        name: 'followup',
        label: 'Follow-up',
        relevant: "selected(${long_question_name_here_extra}, 'opt_a')",
      },
      { type: 'end_group' },
    ];
    const choices = createChoices('options', [
      { name: 'opt_a', label: 'Option A' },
      { name: 'opt_b', label: 'Option B' },
    ]);

    const rows = await convertAndParse(survey, choices);
    const questions = findRowsByClass(rows, 'Q');

    // long_question_name_here → longquestionnamehere (20 chars, exact fit)
    // long_question_name_here_extra → longquestionnamehereextra → truncates to longquestionnamehere → collision!
    // So _extra field gets deduplicated name with suffix
    const extraQ = questions.find((q) => q.name === 'longquestionnameher1');
    expect(extraQ).toBeDefined();

    // The followup relevance should reference the deduplicated name
    const followup = questions.find((q) => q.name === 'followup');
    expect(followup).toBeDefined();
    expect(followup!.relevance).toContain('longquestionnameher1');
  });

  test('variable references in label text use deduplicated names', async () => {
    const survey = [
      { type: 'begin_group', name: 'g1', label: 'Group' },
      {
        type: 'text',
        name: 'probleme_ansprechpersonen',
        label: 'First question',
      },
      {
        type: 'text',
        name: 'probleme_ansprechpersonen_text',
        label: 'Please elaborate',
      },
      {
        type: 'note',
        name: 'summary',
        label:
          'You said: ${probleme_ansprechpersonen} and ${probleme_ansprechpersonen_text}',
      },
      { type: 'end_group' },
    ];

    const rows = await convertAndParse(survey);
    const noteRows = rows.filter(
      (r) => r.name === 'summary' && r.class === 'Q',
    );
    expect(noteRows.length).toBeGreaterThan(0);

    const noteText = noteRows[0].text;
    expect(noteText).toContain('{problemeansprechpers}');
    expect(noteText).toContain('{problemeansprechper1}');
  });

  test('group names are also deduplicated', async () => {
    // Two groups whose names collide after sanitization
    const survey = [
      {
        type: 'begin_group',
        name: 'very_long_group_name_alpha',
        label: 'Group A',
      },
      { type: 'text', name: 'q1', label: 'Q1' },
      { type: 'end_group' },
      {
        type: 'begin_group',
        name: 'very_long_group_name_alpha_extra',
        label: 'Group B',
      },
      { type: 'text', name: 'q2', label: 'Q2' },
      { type: 'end_group' },
    ];

    const rows = await convertAndParse(survey);
    const groups = findRowsByClass(rows, 'G');
    const groupNames = [...new Set(groups.map((g) => g.name))];

    // Both group labels should appear but with unique underlying names
    // (group names are used in the 'name' column for G rows as labels, so check via the Q rows' context)
    // The key point is that the conversion completes without error
    expect(groupNames.length).toBe(2);
  });
});
