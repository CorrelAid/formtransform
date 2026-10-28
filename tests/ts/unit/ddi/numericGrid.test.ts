/**
 * A table of numbers (#174): a `table-list` group of integer / decimal rows
 * is a grid, so every row carries the question printed above the table.
 */
import { describe, test, expect } from 'vitest';

import { xlsformToLstsv } from '../../../../src/api.js';
import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import { ddiToXlsform } from '../../../../src/pipelines/ddi2xlsform/index.js';
import { parseTSV } from '../helpers';

type Row = Record<string, unknown>;

const CHOICES = [
  { list_name: 's', name: 'ja', label: 'Ja' },
  { list_name: 's', name: 'nein', label: 'Nein' },
];

const table = (...rows: Row[]): Row[] => [
  {
    type: 'begin_group',
    name: 'besch',
    'label::Deutsch (de)': 'Wie viele Beschäftigte?',
    'label::English (en)': 'How many employees?',
    appearance: 'table-list',
  },
  ...rows,
  { type: 'end_group' },
];

const row = (type: string, name: string): Row => ({
  type,
  name,
  'label::Deutsch (de)': name,
  'label::English (en)': name,
});

const SETTINGS = { default_language: 'Deutsch (de)' };

function build(survey: Row[]): string {
  return buildDdiXml(survey, CHOICES, {
    prodDate: '2020-01-01',
    settings: SETTINGS,
  });
}

function varEl(xml: string, name: string): string {
  const start = xml.indexOf(`<var ID="V_${name}"`);
  return start < 0 ? '' : xml.slice(start, xml.indexOf('</var>', start));
}

describe('xlsform2ddi', () => {
  test('integer and decimal rows are a grid; each row has its text as preQTxt', () => {
    const xml = build(
      table(
        row('integer', 'gesamt'),
        row('integer', 'weiblich'),
        row('decimal', 'anteil'),
      ),
    );
    expect(xml).toContain(
      '<varGrp ID="VG_besch" name="besch" type="grid" var="V_gesamt V_weiblich V_anteil">',
    );
    for (const name of ['gesamt', 'weiblich', 'anteil']) {
      expect(varEl(xml, name)).toContain(
        '<preQTxt>Wie viele Beschäftigte?</preQTxt>\n' +
          '        <preQTxt xml:lang="en">How many employees?</preQTxt>',
      );
      expect(varEl(xml, name)).toContain('responseDomainType="numeric"');
    }
    // A grid's table-list is its type: no appearance note.
    expect(xml).not.toContain('cdl:appearance');
  });

  test.each([
    ['a text row', row('text', 'name')],
    ['a select_one row', { ...row('select_one s', 'ja') }],
  ])('with %s it is a section, its appearance a note', (_, other) => {
    const xml = build(table(row('integer', 'gesamt'), other));
    expect(xml).toContain('name="besch" type="section"');
    expect(xml).not.toContain('type="grid"');
    expect(xml).toContain('<notes type="cdl:appearance">table-list</notes>');
    expect(xml).not.toContain('<preQTxt>');
  });
});

describe('notes in a grid', () => {
  // CVTS7 1.1: "davon: …" printed once between the total and its breakdown.
  const survey = table(
    row('integer', 'gesamt'),
    { ...row('note', 'davon'), 'label::Deutsch (de)': 'davon: Geschlecht' },
    row('integer', 'm'),
    row('integer', 'w'),
  );
  const xml = build(survey);

  test('a note between rows is a cdl:grid_note about the row after it', () => {
    expect(xml).toContain(
      '<notes type="cdl:grid_note" subject="m">davon: Geschlecht</notes>',
    );
    expect(varEl(xml, 'm')).toContain(
      '<notes type="cdl:note_names">davon</notes>',
    );
    // Not copied into a row, and not the rows' preQTxt.
    expect(varEl(xml, 'm')).not.toContain('davon: Geschlecht');
    expect(varEl(xml, 'w')).not.toContain('cdl:note_names');
  });

  test('comes back as one note row in its place', () => {
    const back = ddiToXlsform(xml).survey;
    expect(back.map((r) => r.name)).toEqual([
      'besch',
      'gesamt',
      'davon',
      'm',
      'w',
      undefined,
    ]);
    expect(back[2]).toMatchObject({ type: 'note' });
  });
});

describe('range rows', () => {
  test('are a table of numbers too', () => {
    const xml = build(table(row('range', 'a'), row('integer', 'b')));
    expect(xml).toContain('name="besch" type="grid"');
  });
});

describe('ddi2xlsform', () => {
  test('gives back one table-list group with one label', () => {
    const survey = table(row('integer', 'gesamt'), row('decimal', 'anteil'));
    const xml = build(survey);
    const back = ddiToXlsform(xml);
    expect(back.survey.map((r) => r.type)).toEqual([
      'begin_group',
      'integer',
      'decimal',
      'end_group',
    ]);
    expect(back.survey[0]).toMatchObject({
      name: 'besch',
      appearance: 'table-list',
      label: { de: 'Wie viele Beschäftigte?', en: 'How many employees?' },
    });
    // No note row: the rows' preQTxt is the group's text.
    expect(back.survey.some((r) => r.type === 'note')).toBe(false);
    expect(
      buildDdiXml(back.survey, back.choices, {
        prodDate: '2020-01-01',
        settings: back.settings[0] ?? {},
      }),
    ).toBe(xml);
  });

  test('a section that was a table-list group gets its appearance back', () => {
    const back = ddiToXlsform(
      build(table(row('integer', 'gesamt'), row('text', 'name'))),
    );
    expect(back.survey[0]).toMatchObject({ appearance: 'table-list' });
  });
});

describe('xlsform2lstsv', () => {
  async function lsRows(survey: Row[]) {
    const tsv = await xlsformToLstsv(
      { surveyData: survey as never, choicesData: CHOICES as never },
      { skipValidation: true, onWarning: () => {} },
    );
    return parseTSV(tsv).map((r) => `${r.class}:${r['type/scale']}:${r.name}`);
  }

  test('a table of numbers is a plain group of number questions, no array', async () => {
    const rows = await lsRows(
      table(row('integer', 'gesamt'), row('decimal', 'anteil')),
    );
    expect(rows).toContain('Q:N:gesamt');
    expect(rows).toContain('Q:N:anteil');
    expect(rows.some((r) => r.startsWith('Q:F:'))).toBe(false);
    expect(rows.some((r) => r.startsWith('SQ:'))).toBe(false);
  });

  test('a table-list group with choice rows is still an array', async () => {
    const rows = await lsRows(table(row('select_one s', 'ja')));
    expect(rows).toContain('Q:F:besch');
    expect(rows).toContain('SQ::ja');
  });
});
