import { describe, test, expect } from 'vitest';
import {
  convertAndParse,
  findRowsByClass,
  findRowByName,
  createChoices,
} from './helpers';

// ==============================================================
// Tests for ConversionConfig settings
// ==============================================================

describe('convertWelcomeNote', () => {
  const survey = [
    { type: 'note', name: 'welcome', label: 'Welcome to the survey!' },
    { type: 'text', name: 'q1', label: 'Question' },
  ];
  const settings = [{ form_title: 'Test', default_language: 'en' }];

  test('true (default): welcome note promoted to SL row, not a question', async () => {
    const rows = await convertAndParse(survey, [], settings);
    const sl = findRowsByClass(rows, 'SL').find(
      (r) => r.name === 'surveyls_welcometext',
    );
    expect(sl).toBeDefined();
    expect(sl?.text).toBe('Welcome to the survey!');
    expect(
      findRowsByClass(rows, 'Q').find((r) => r.name === 'welcome'),
    ).toBeUndefined();
  });

  test('false: welcome note stays as a regular note question', async () => {
    const rows = await convertAndParse(survey, [], settings, {
      convertWelcomeNote: false,
    });
    const sl = findRowsByClass(rows, 'SL').find(
      (r) => r.name === 'surveyls_welcometext',
    );
    expect(sl).toBeUndefined();
    const q = findRowsByClass(rows, 'Q').find((r) => r.name === 'welcome');
    expect(q).toBeDefined();
    expect(q?.text).toBe('Welcome to the survey!');
  });

  test('false: group wrapping only a welcome note is NOT suppressed', async () => {
    const groupedSurvey = [
      { type: 'begin_group', name: 'intro', label: 'Intro' },
      { type: 'note', name: 'welcome', label: 'Welcome!' },
      { type: 'end_group' },
      { type: 'begin_group', name: 'main', label: 'Main' },
      { type: 'text', name: 'q1', label: 'Question' },
      { type: 'end_group' },
    ];
    const rows = await convertAndParse(groupedSurvey, [], settings, {
      convertWelcomeNote: false,
    });
    const groups = findRowsByClass(rows, 'G');
    // G row name field holds the rendered label, not the XLSForm name
    expect(groups.find((r) => r.name === 'Intro')).toBeDefined();
  });
});

describe('convertEndNote', () => {
  const survey = [
    { type: 'text', name: 'q1', label: 'Question' },
    { type: 'note', name: 'end', label: 'Thank you!' },
  ];
  const settings = [{ form_title: 'Test', default_language: 'en' }];

  test('true (default): end note promoted to SL row, not a question', async () => {
    const rows = await convertAndParse(survey, [], settings);
    const sl = findRowsByClass(rows, 'SL').find(
      (r) => r.name === 'surveyls_endtext',
    );
    expect(sl).toBeDefined();
    expect(sl?.text).toBe('Thank you!');
    expect(
      findRowsByClass(rows, 'Q').find((r) => r.name === 'end'),
    ).toBeUndefined();
  });

  test('false: end note stays as a regular note question', async () => {
    const rows = await convertAndParse(survey, [], settings, {
      convertEndNote: false,
    });
    const sl = findRowsByClass(rows, 'SL').find(
      (r) => r.name === 'surveyls_endtext',
    );
    expect(sl).toBeUndefined();
    const q = findRowsByClass(rows, 'Q').find((r) => r.name === 'end');
    expect(q).toBeDefined();
    expect(q?.text).toBe('Thank you!');
  });

  test('disabling one does not affect the other', async () => {
    const bothSurvey = [
      { type: 'note', name: 'welcome', label: 'Hello!' },
      { type: 'text', name: 'q1', label: 'Q' },
      { type: 'note', name: 'end', label: 'Bye!' },
    ];
    const rows = await convertAndParse(bothSurvey, [], settings, {
      convertEndNote: false,
    });
    // welcome still promoted
    expect(
      findRowsByClass(rows, 'SL').find(
        (r) => r.name === 'surveyls_welcometext',
      ),
    ).toBeDefined();
    // end NOT promoted
    expect(
      findRowsByClass(rows, 'SL').find((r) => r.name === 'surveyls_endtext'),
    ).toBeUndefined();
    expect(
      findRowsByClass(rows, 'Q').find((r) => r.name === 'end'),
    ).toBeDefined();
  });
});

describe('convertOtherPattern', () => {
  const choices = createChoices('colors', [
    { name: 'red', label: 'Red' },
    { name: 'blue', label: 'Blue' },
    { name: 'other', label: 'Other' },
  ]);
  const survey = [
    { type: 'select_one colors', name: 'fav_color', label: 'Favorite color?' },
    {
      type: 'text',
      name: 'fav_color_other',
      label: 'Please specify',
      relevant: "${fav_color} = 'other'",
    },
  ];
  const settings = [{ form_title: 'Test', default_language: 'en' }];

  test('true (default): detects _other pattern, sets other=Y, removes other choice', async () => {
    const rows = await convertAndParse(survey, choices, settings);
    const q = findRowByName(rows, 'favcolor');
    expect(q?.other).toBe('Y');
    // "other" choice should be removed from answers
    const answers = findRowsByClass(rows, 'A');
    expect(answers.find((r) => r.name === 'other')).toBeUndefined();
    // LimeSurvey's native "other" box replaces the companion (#79).
    expect(findRowByName(rows, 'favcolorother')).toBeUndefined();
  });

  test('a reference to the folded companion becomes <code>_other (#79)', async () => {
    const rows = await convertAndParse(
      [
        ...survey,
        {
          type: 'note',
          name: 'thanks',
          label: 'You said ${fav_color_other}',
          relevant: "${fav_color_other} != ''",
        },
      ],
      choices,
      settings,
    );
    const note = findRowByName(rows, 'thanks');
    expect(note?.text).toBe('You said {favcolor_other}');
    expect(note?.relevance).toContain('favcolor_other');
    expect(note?.relevance).not.toContain('favcolorother');
  });

  test('false: _other pattern ignored, other choice kept, other=empty', async () => {
    const rows = await convertAndParse(survey, choices, settings, {
      convertOtherPattern: false,
    });
    const q = findRowByName(rows, 'favcolor');
    expect(q?.other).toBe('');
    expect(findRowByName(rows, 'favcolorother')).toBeDefined();
    // "other" choice should remain
    const answers = findRowsByClass(rows, 'A');
    expect(answers.find((r) => r.name === 'other')).toBeDefined();
  });

  test('detects _other pattern for select_multiple with selected() relevance', async () => {
    const multiChoices = createChoices('items', [
      { name: 'a', label: 'Item A' },
      { name: 'b', label: 'Item B' },
      { name: 'other', label: 'Other' },
    ]);
    const multiSurvey = [
      { type: 'select_multiple items', name: 'picked', label: 'Pick items' },
      {
        type: 'text',
        name: 'picked_other',
        label: 'Please specify',
        relevant: "selected(${picked}, 'other')",
      },
    ];
    const rows = await convertAndParse(multiSurvey, multiChoices, settings);
    const q = findRowByName(rows, 'picked');
    expect(q?.other).toBe('Y');
    const answers = findRowsByClass(rows, 'A');
    expect(answers.find((r) => r.name === 'other')).toBeUndefined();
    expect(findRowByName(rows, 'pickedother')).toBeUndefined();
  });

  test('false does not affect or_other type modifier', async () => {
    const orOtherSurvey = [
      { type: 'select_one colors or_other', name: 'q1', label: 'Pick' },
    ];
    const simpleChoices = createChoices('colors', [
      { name: 'red', label: 'Red' },
      { name: 'blue', label: 'Blue' },
    ]);
    const rows = await convertAndParse(orOtherSurvey, simpleChoices, settings, {
      convertOtherPattern: false,
    });
    const q = findRowByName(rows, 'q1');
    // or_other modifier is a type feature, not the _other pattern — should still work
    expect(q?.other).toBe('Y');
  });
});

describe('convertMarkdown', () => {
  const settings = [{ form_title: 'Test', default_language: 'en' }];

  test('true (default): markdown in labels is converted to HTML', async () => {
    const survey = [
      { type: 'text', name: 'q1', label: '**Bold** and _italic_' },
    ];
    const rows = await convertAndParse(survey, [], settings);
    const q = findRowByName(rows, 'q1');
    expect(q?.text).toContain('<strong>Bold</strong>');
    expect(q?.text).toContain('<em>italic</em>');
  });

  test('false: labels are passed through as plain text', async () => {
    const survey = [
      { type: 'text', name: 'q1', label: '**Bold** and _italic_' },
    ];
    const rows = await convertAndParse(survey, [], settings, {
      convertMarkdown: false,
    });
    const q = findRowByName(rows, 'q1');
    expect(q?.text).toBe('**Bold** and _italic_');
  });

  test('false: hints are also passed through as plain text', async () => {
    const survey = [
      {
        type: 'text',
        name: 'q1',
        label: 'Question',
        hint: 'See [here](https://example.com)',
      },
    ];
    const rows = await convertAndParse(survey, [], settings, {
      convertMarkdown: false,
    });
    const q = findRowByName(rows, 'q1');
    expect(q?.help).toContain('[here](https://example.com)');
    expect(q?.help).not.toContain('<a');
  });

  test('false: group labels are also plain text', async () => {
    const survey = [
      { type: 'begin_group', name: 'g1', label: '**Group Title**' },
      { type: 'text', name: 'q1', label: 'Q' },
      { type: 'end_group' },
    ];
    const rows = await convertAndParse(survey, [], settings, {
      convertMarkdown: false,
    });
    // G row name field holds the rendered label
    const g = findRowsByClass(rows, 'G').find(
      (r) => r.name === '**Group Title**',
    );
    expect(g).toBeDefined();
  });

  test('false: answer labels are also plain text', async () => {
    const choices = createChoices('yn', [
      { name: 'yes', label: '**Yes**' },
      { name: 'no', label: '_No_' },
    ]);
    const survey = [{ type: 'select_one yn', name: 'q1', label: 'Choose' }];
    const rows = await convertAndParse(survey, choices, settings, {
      convertMarkdown: false,
    });
    const answers = findRowsByClass(rows, 'A');
    expect(answers.find((r) => r.name === 'yes')?.text).toBe('**Yes**');
    expect(answers.find((r) => r.name === 'no')?.text).toBe('_No_');
  });

  test('false: welcome/end note text is also plain when both settings interact', async () => {
    const survey = [
      { type: 'note', name: 'welcome', label: '**Welcome!**' },
      { type: 'text', name: 'q1', label: 'Q' },
    ];
    const rows = await convertAndParse(survey, [], settings, {
      convertMarkdown: false,
    });
    const sl = findRowsByClass(rows, 'SL').find(
      (r) => r.name === 'surveyls_welcometext',
    );
    expect(sl?.text).toBe('**Welcome!**');
  });
});

describe('settings combinations', () => {
  const settings = [{ form_title: 'Test', default_language: 'en' }];

  test('all settings disabled at once', async () => {
    const choices = createChoices('colors', [
      { name: 'red', label: 'Red' },
      { name: 'other', label: 'Other' },
    ]);
    const survey = [
      { type: 'note', name: 'welcome', label: '**Hello**' },
      { type: 'select_one colors', name: 'fav', label: '_Pick_' },
      {
        type: 'text',
        name: 'fav_other',
        label: 'Specify',
        relevant: "${fav} = 'other'",
      },
      { type: 'note', name: 'end', label: '**Bye**' },
    ];
    const rows = await convertAndParse(survey, choices, settings, {
      convertWelcomeNote: false,
      convertEndNote: false,
      convertOtherPattern: false,
      convertMarkdown: false,
    });

    // No SL welcome/end rows
    const slRows = findRowsByClass(rows, 'SL');
    expect(
      slRows.find((r) => r.name === 'surveyls_welcometext'),
    ).toBeUndefined();
    expect(slRows.find((r) => r.name === 'surveyls_endtext')).toBeUndefined();

    // welcome and end are regular questions
    const qRows = findRowsByClass(rows, 'Q');
    expect(qRows.find((r) => r.name === 'welcome')).toBeDefined();
    expect(qRows.find((r) => r.name === 'end')).toBeDefined();

    // other choice kept
    const answers = findRowsByClass(rows, 'A');
    expect(answers.find((r) => r.name === 'other')).toBeDefined();

    // no markdown conversion
    expect(qRows.find((r) => r.name === 'welcome')?.text).toBe('**Hello**');
    expect(findRowByName(rows, 'fav')?.text).toBe('_Pick_');
  });

  test('defaults produce same output as explicit true values', async () => {
    const survey = [
      { type: 'note', name: 'welcome', label: '**Hello**' },
      { type: 'text', name: 'q1', label: '_Q_' },
      { type: 'note', name: 'end', label: '**Bye**' },
    ];

    const defaultRows = await convertAndParse(survey, [], settings);
    const explicitRows = await convertAndParse(survey, [], settings, {
      convertWelcomeNote: true,
      convertEndNote: true,
      convertOtherPattern: true,
      convertMarkdown: true,
    });

    expect(defaultRows).toEqual(explicitRows);
  });
});

describe('default group (#74)', () => {
  const groupRow = async (config: Record<string, unknown> = {}) =>
    (
      await convertAndParse(
        [{ type: 'text', name: 'q', label: 'Q' }],
        [],
        undefined,
        config,
      )
    ).find((r) => r.class === 'G');

  test('has the configured name and no invented description', async () => {
    const g = await groupRow({
      defaults: {
        language: 'en',
        groupName: 'Fragen',
        surveyTitle: 'T',
        description: '',
      },
    });
    expect(g?.name).toBe('Fragen');
    expect(g?.text ?? '').toBe('');
  });

  test('defaults to "Questions", still without a description', async () => {
    const g = await groupRow();
    expect(g?.name).toBe('Questions');
    expect(g?.text ?? '').toBe('');
  });
});
