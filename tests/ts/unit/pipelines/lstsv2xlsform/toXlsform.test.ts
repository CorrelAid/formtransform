/** LimeSurvey rows → XLSForm reconstruction, feature-level. */
import { describe, test, expect } from 'vitest';

import { lstsvRowsToXlsform } from '../../../../../src/pipelines/lstsv2xlsform/toXlsform.js';

type Row = Record<string, string>;
function row(fields: Partial<Row> & Pick<Row, 'class'>): Row {
  return { language: 'en', ...fields } as Row;
}

const LANG_EN = row({ class: 'S', name: 'language', text: 'en' });
const DEFAULT_GROUP = row({ class: 'G', name: 'Questions', text: 'Questions' });

describe('lstsvRowsToXlsform — plain questions', () => {
  test('the synthetic default group is omitted', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'Q1' }),
    ]);
    expect(survey).toEqual([{ type: 'text', name: 'q1', label: 'Q1' }]);
  });

  test('required and default are only emitted when set', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'N',
        name: 'age',
        text: 'Age',
        mandatory: 'Y',
        default: '18',
      }),
    ]);
    expect(survey[0]).toMatchObject({ required: 'yes', default: '18' });
  });

  test('hint is only emitted when present', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'S',
        name: 'q1',
        text: 'Q1',
        help: 'A hint',
      }),
    ]);
    expect(survey[0]).toMatchObject({ hint: 'A hint' });
    const { survey: noHint } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'S', name: 'q2', text: 'Q2' }),
    ]);
    expect(noHint[0]).not.toHaveProperty('hint');
  });
});

describe('lstsvRowsToXlsform — date/time', () => {
  test('D with no date_format is date', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'D', name: 'dob', text: 'DOB' }),
    ]);
    expect(survey[0].type).toBe('date');
  });

  test('D with date_format HH:MM is time', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'D',
        name: 'wake',
        text: 'Wake',
        date_format: 'HH:MM',
      }),
    ]);
    expect(survey[0].type).toBe('time');
  });
});

describe('lstsvRowsToXlsform — appearance overrides', () => {
  test('! type/scale becomes select_one + appearance minimal', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': '!', name: 'q1', text: 'Q1' }),
      row({ class: 'A', name: 'a', text: 'A' }),
    ]);
    expect(survey[0]).toMatchObject({
      type: 'select_one q1',
      appearance: 'minimal',
    });
  });

  test('T type/scale becomes text + appearance multiline', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'T', name: 'q1', text: 'Q1' }),
    ]);
    expect(survey[0]).toMatchObject({ type: 'text', appearance: 'multiline' });
  });

  test('em_validation_q reverses to constraint', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'N',
        name: 'age',
        text: 'Age',
        em_validation_q: 'self >= 18 and self <= 100',
      }),
    ]);
    expect(survey[0]).toMatchObject({ constraint: '. >= 18 and . <= 100' });
  });
});

describe('lstsvRowsToXlsform — choices', () => {
  test('select_one A rows become choices keyed by the question name', () => {
    const { survey, choices } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'L', name: 'color', text: 'Colour' }),
      row({ class: 'A', name: 'r', text: 'Red' }),
      row({ class: 'A', name: 'g', text: 'Green' }),
    ]);
    expect(survey[0].type).toBe('select_one color');
    expect(choices).toEqual([
      { list_name: 'color', name: 'r', label: 'Red' },
      { list_name: 'color', name: 'g', label: 'Green' },
    ]);
  });

  test('select_multiple SQ rows become choices', () => {
    const { survey, choices } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'M', name: 'langs', text: 'Languages' }),
      row({ class: 'SQ', name: 'de', text: 'German' }),
      row({ class: 'SQ', name: 'en', text: 'English' }),
    ]);
    expect(survey[0].type).toBe('select_multiple langs');
    expect(choices.map((c) => c.name)).toEqual(['de', 'en']);
  });
});

describe('lstsvRowsToXlsform — cdlvocab (select_*_from_file)', () => {
  test('cssclass cdlvocab-<id> becomes select_one_from_file <id>.csv, no choices', () => {
    const { survey, choices } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'L',
        name: 'country',
        text: 'Country',
        cssclass: 'cdlvocab-iso_3166_1',
      }),
      row({ class: 'A', name: 'de', text: 'Germany' }),
    ]);
    expect(survey[0].type).toBe('select_one_from_file iso_3166_1.csv');
    expect(choices).toEqual([]);
  });
});

describe('lstsvRowsToXlsform — other pattern', () => {
  test('other=Y select + <base>other companion → other choice + _other companion', () => {
    const { survey, choices } = lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'L',
        name: 'source',
        text: 'Source',
        other: 'Y',
      }),
      row({ class: 'A', name: 'a', text: 'A' }),
      row({
        class: 'Q',
        'type/scale': 'S',
        name: 'sourceother',
        text: 'Please specify',
        relevance: "source == 'other'",
      }),
    ]);
    expect(survey).toEqual([
      { type: 'select_one source', name: 'source', label: 'Source' },
      {
        type: 'text',
        name: 'source_other',
        label: 'Please specify',
        relevant: "${source} = 'other'",
      },
    ]);
    expect(choices).toEqual([
      { list_name: 'source', name: 'a', label: 'A' },
      { list_name: 'source', name: 'other', label: 'Other' },
    ]);
  });
});

describe('lstsvRowsToXlsform — grid (table-list array)', () => {
  test('F + SQ + A become begin_group(table-list) + select_one per subquestion', () => {
    const { survey, choices } = lstsvRowsToXlsform([
      LANG_EN,
      row({ class: 'G', 'type/scale': '1', name: 'Trust', text: '' }),
      row({ class: 'Q', 'type/scale': 'F', name: 'trust', text: 'Trust' }),
      row({ class: 'SQ', name: 'parl', text: 'Parliament' }),
      row({ class: 'SQ', name: 'police', text: 'Police' }),
      row({ class: 'A', name: '1', text: 'Low' }),
      row({ class: 'A', name: '2', text: 'High' }),
    ]);
    expect(survey).toEqual([
      {
        type: 'begin_group',
        name: 'trust',
        label: 'Trust',
        appearance: 'table-list',
      },
      { type: 'select_one trust', name: 'parl', label: 'Parliament' },
      { type: 'select_one trust', name: 'police', label: 'Police' },
      { type: 'end_group' },
    ]);
    expect(choices).toEqual([
      { list_name: 'trust', name: '1', label: 'Low' },
      { list_name: 'trust', name: '2', label: 'High' },
    ]);
  });
});

describe('lstsvRowsToXlsform — groups', () => {
  test('non-grid explicit group emits begin_group with slugified name', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      row({
        class: 'G',
        'type/scale': 'S',
        name: 'My Section',
        text: 'My Section',
      }),
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'Q1' }),
    ]);
    expect(survey).toEqual([
      { type: 'begin_group', name: 'mysection', label: 'My Section' },
      { type: 'text', name: 'q1', label: 'Q1' },
      { type: 'end_group' },
    ]);
  });

  test('multi-word group label is slugified to first four words', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      row({
        class: 'G',
        'type/scale': 'S',
        name: 'Very Long Group Label Here',
        text: 'Very Long Group Label Here',
      }),
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'Q1' }),
    ]);
    expect(survey[0]).toMatchObject({
      type: 'begin_group',
      name: 'verylonggrouplabel',
      label: 'Very Long Group Label Here',
    });
  });

  test('group with only special chars falls back to "group"', () => {
    const { survey } = lstsvRowsToXlsform([
      LANG_EN,
      row({ class: 'G', 'type/scale': 'S', name: '!!!', text: '!!!' }),
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'Q1' }),
    ]);
    expect(survey[0]).toMatchObject({ type: 'begin_group', name: 'group' });
  });
});

describe('lstsvRowsToXlsform — settings', () => {
  test('default_language is omitted for English', () => {
    const { settings } = lstsvRowsToXlsform([
      LANG_EN,
      row({ class: 'SL', name: 'surveyls_title', text: 'Untitled Survey' }),
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'Q1' }),
    ]);
    expect(settings).toEqual([]);
  });

  test('non-English base language is reconstructed with its exonym', () => {
    const { settings } = lstsvRowsToXlsform([
      row({ class: 'S', name: 'language', text: 'de' }),
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'S',
        name: 'q1',
        text: 'Q1',
        language: 'de',
      }),
    ]);
    expect(settings).toEqual([{ default_language: 'German (de)' }]);
  });

  test('a non-default survey title is reconstructed', () => {
    const { settings } = lstsvRowsToXlsform([
      LANG_EN,
      row({ class: 'SL', name: 'surveyls_title', text: 'My Survey' }),
      DEFAULT_GROUP,
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'Q1' }),
    ]);
    expect(settings).toEqual([{ form_title: 'My Survey' }]);
  });
});

describe('lstsvRowsToXlsform — multi-language', () => {
  test('two languages produce label:: object maps', () => {
    const { survey } = lstsvRowsToXlsform([
      row({ class: 'S', name: 'language', text: 'en' }),
      row({ class: 'S', name: 'additional_languages', text: 'de' }),
      row({
        class: 'G',
        'type/scale': '',
        name: 'Questions',
        text: 'Questions',
        language: 'en',
      }),
      row({
        class: 'Q',
        'type/scale': 'S',
        name: 'q1',
        text: 'Hello',
        language: 'en',
      }),
      row({
        class: 'Q',
        'type/scale': 'S',
        name: 'q1',
        text: 'Hallo',
        language: 'de',
      }),
    ]);
    expect(survey[0]).toMatchObject({
      name: 'q1',
      label: { en: 'Hello', de: 'Hallo' },
    });
  });
});

describe('lstsvRowsToXlsform — range (#33)', () => {
  const numeric = (attrs: Partial<Row>) =>
    lstsvRowsToXlsform([
      LANG_EN,
      DEFAULT_GROUP,
      row({
        class: 'Q',
        'type/scale': 'N',
        name: 'score',
        text: 'Score',
        ...attrs,
      }),
    ]).survey[0];

  test('a bounded integer-only N becomes range with step=1', () => {
    expect(
      numeric({
        min_num_value_n: '0',
        max_num_value_n: '10',
        num_value_int_only: '1',
      }),
    ).toMatchObject({ type: 'range', parameters: 'start=0 end=10 step=1' });
  });

  test('without the integer-only flag the step is left to the default', () => {
    expect(
      numeric({ min_num_value_n: '0', max_num_value_n: '1' }),
    ).toMatchObject({
      type: 'range',
      parameters: 'start=0 end=1',
    });
  });

  test('an N with only one bound stays decimal', () => {
    const q = numeric({ min_num_value_n: '0' });
    expect(q.type).toBe('decimal');
    expect(q.parameters).toBeUndefined();
  });
});
