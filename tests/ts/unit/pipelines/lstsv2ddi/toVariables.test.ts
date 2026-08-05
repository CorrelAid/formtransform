/** LimeSurvey rows → canonical Variable model. */
import { describe, test, expect } from 'vitest';

import { lstsvToVariables } from '../../../../../src/pipelines/lstsv2ddi/toVariables.js';

type Row = Record<string, string>;

/** Build a row with the columns the adapter reads (rest default to ''). */
function row(fields: Partial<Row> & Pick<Row, 'class'>): Row {
  return { language: 'en', ...fields } as Row;
}

const LANG = row({ class: 'S', name: 'language', text: 'en' });

describe('lstsvToVariables — type mapping', () => {
  test('collapses LimeSurvey codes onto DDI-lossless std slugs', () => {
    const vars = lstsvToVariables([
      LANG,
      row({ class: 'Q', 'type/scale': 'N', name: 'age', text: 'Age' }),
      row({ class: 'Q', 'type/scale': 'D', name: 'dob', text: 'DOB' }),
      row({ class: 'Q', 'type/scale': 'S', name: 'note1', text: 'Free' }),
      row({ class: 'Q', 'type/scale': 'X', name: 'info', text: 'Info' }),
    ]);
    expect(vars.map((v) => [v.name, v.type])).toEqual([
      ['age', 'decimal'],
      ['dob', 'date'],
      ['note1', 'text'],
      ['info', 'note'],
    ]);
  });
});

describe('lstsvToVariables — choices', () => {
  test('A rows attach as select_one choices', () => {
    const vars = lstsvToVariables([
      LANG,
      row({ class: 'Q', 'type/scale': 'L', name: 'color', text: 'Colour' }),
      row({ class: 'A', name: 'r', text: 'Red' }),
      row({ class: 'A', name: 'g', text: 'Green' }),
    ]);
    expect(vars[0].type).toBe('select_one');
    expect(vars[0].listName).toBe('color');
    expect(vars[0].choices).toEqual([
      { name: 'r', label: 'Red' },
      { name: 'g', label: 'Green' },
    ]);
  });

  test('SQ rows attach as select_multiple choices', () => {
    const vars = lstsvToVariables([
      LANG,
      row({ class: 'Q', 'type/scale': 'M', name: 'langs', text: 'Languages' }),
      row({ class: 'SQ', name: 'de', text: 'German' }),
      row({ class: 'SQ', name: 'en', text: 'English' }),
    ]);
    expect(vars[0].type).toBe('select_multiple');
    expect(vars[0].choices.map((c) => c.name)).toEqual(['de', 'en']);
  });
});

describe('lstsvToVariables — cssclass vocab', () => {
  test('maps cssclass "cdlvocab-<id>" to Variable.vocab and drops inlined options', () => {
    const vars = lstsvToVariables([
      LANG,
      row({
        class: 'Q',
        'type/scale': 'L',
        name: 'country',
        text: 'Country',
        cssclass: 'cdlvocab-iso_3166_1',
      }),
      row({ class: 'A', name: 'de', text: 'Germany' }),
    ]);
    expect(vars[0].type).toBe('select_one_from_file');
    expect(vars[0].vocab).toBe('iso_3166_1');
    // Options were inlined in the TSV but DDI emits <concept vocab>, no <catgry>.
    expect(vars[0].choices).toEqual([]);
  });

  test('select_multiple + cssclass vocab becomes select_multiple_from_file', () => {
    const vars = lstsvToVariables([
      LANG,
      row({
        class: 'Q',
        'type/scale': 'M',
        name: 'visited',
        text: 'Visited',
        cssclass: 'cdlvocab-iso_3166_1',
      }),
    ]);
    expect(vars[0].type).toBe('select_multiple_from_file');
    expect(vars[0].vocab).toBe('iso_3166_1');
  });

  test('a non-vocab cssclass is ignored (plain select_one)', () => {
    const vars = lstsvToVariables([
      LANG,
      row({
        class: 'Q',
        'type/scale': 'L',
        name: 'color',
        text: 'Colour',
        cssclass: 'wide',
      }),
      row({ class: 'A', name: 'r', text: 'Red' }),
    ]);
    expect(vars[0].type).toBe('select_one');
    expect(vars[0].vocab).toBe('');
    expect(vars[0].choices).toEqual([{ name: 'r', label: 'Red' }]);
  });
});

describe('lstsvToVariables — group + array', () => {
  test('a preceding G row carries the group label', () => {
    const vars = lstsvToVariables([
      LANG,
      row({ class: 'G', name: 'Demographics' }),
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'Q1' }),
    ]);
    expect(vars[0].group).toBe('Demographics');
    expect(vars[0].groupLabel).toBe('Demographics');
  });

  test('an F array expands into per-subquestion select_one grid vars', () => {
    const vars = lstsvToVariables([
      LANG,
      row({ class: 'Q', 'type/scale': 'F', name: 'trust', text: 'Trust' }),
      row({ class: 'SQ', name: 'parl', text: 'Parliament' }),
      row({ class: 'SQ', name: 'police', text: 'Police' }),
      row({ class: 'A', name: '1', text: 'Low' }),
      row({ class: 'A', name: '2', text: 'High' }),
    ]);
    expect(vars).toHaveLength(2);
    for (const v of vars) {
      expect(v.type).toBe('select_one');
      expect(v.groupAppearance).toBe('table-list');
      expect(v.group).toBe('trust');
      expect(v.choices).toEqual([
        { name: '1', label: 'Low' },
        { name: '2', label: 'High' },
      ]);
    }
    expect(vars.map((v) => v.name)).toEqual(['parl', 'police']);
  });
});

describe('lstsvToVariables — languages', () => {
  test('keeps only base-language rows (translations are duplicates)', () => {
    const vars = lstsvToVariables([
      LANG,
      row({ class: 'Q', 'type/scale': 'S', name: 'q1', text: 'English' }),
      row({
        class: 'Q',
        'type/scale': 'S',
        name: 'q1',
        text: 'Deutsch',
        language: 'de',
      }),
    ]);
    expect(vars).toHaveLength(1);
    expect(vars[0].label).toBe('English');
  });
});
