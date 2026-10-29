/**
 * `<concept>` is optional (#173): it comes only from the form's `concept`
 * column, never from the label, and `ddi2xlsform` gives it back.
 */
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import { ddiToXlsform } from '../../../../src/pipelines/ddi2xlsform/index.js';

type Row = Record<string, unknown>;

const CHOICES = [
  { list_name: 'm', name: 'a', label: 'A' },
  { list_name: 'm', name: 'other', label: 'Other' },
  // No "other" answer: the or_other shorthand adds one.
  { list_name: 'n', name: 'a', label: 'A' },
];

function build(survey: Row[], settings: Row = {}): string {
  return buildDdiXml(survey, CHOICES, { prodDate: '2020-01-01', settings });
}

/** The element `<tag ID="id" …>` up to its end tag. */
function element(xml: string, tag: string, id: string): string {
  const start = xml.indexOf(`<${tag} ID="${id}"`);
  return start < 0 ? '' : xml.slice(start, xml.indexOf(`</${tag}>`, start));
}

describe('without a concept column', () => {
  test('no var or varGrp has a concept', () => {
    const xml = build([
      { type: 'begin_group', name: 'g', label: 'Group' },
      { type: 'integer', name: 'age', label: 'Age' },
      { type: 'select_multiple m', name: 'mm', label: 'Media' },
      { type: 'select_one n or_other', name: 'so', label: 'One' },
      { type: 'end_group' },
      {
        type: 'begin_group',
        name: 't',
        label: 'Trust',
        appearance: 'table-list',
      },
      { type: 'select_one m', name: 't1', label: 'Row 1' },
      { type: 'end_group' },
    ]);
    expect(xml).not.toContain('<concept');
  });
});

describe('a concept column', () => {
  const xml = build([
    { type: 'begin_group', name: 'g', label: 'Group', concept: 'Work' },
    { type: 'integer', name: 'age', label: 'Age', concept: 'Age in years' },
    {
      type: 'select_multiple m',
      name: 'mm',
      label: 'Media',
      concept: 'Media use',
    },
    { type: 'select_one m', name: 'so', label: 'One', concept: 'Choice' },
    {
      type: 'text',
      name: 'so_other',
      label: 'Other',
      concept: 'Choice, other',
    },
    { type: 'end_group' },
    {
      type: 'begin_group',
      name: 't',
      label: 'Trust',
      appearance: 'table-list',
      concept: 'Institutional trust',
    },
    { type: 'select_one m', name: 't1', label: 'Row 1', concept: 'Trust 1' },
    { type: 'end_group' },
  ]);

  test('is the concept of its var or group', () => {
    expect(element(xml, 'varGrp', 'VG_g')).toContain('<concept>Work</concept>');
    expect(element(xml, 'var', 'V_age')).toContain(
      '<concept>Age in years</concept>',
    );
    expect(element(xml, 'varGrp', 'VG_t')).toContain(
      '<concept>Institutional trust</concept>',
    );
    expect(element(xml, 'var', 'V_t1')).toContain('<concept>Trust 1</concept>');
  });

  test("a select_multiple's is on its varGrp, not its binaries", () => {
    expect(element(xml, 'varGrp', 'VG_mm')).toContain(
      '<concept>Media use</concept>',
    );
    expect(element(xml, 'var', 'V_mm_a')).not.toContain('<concept');
  });

  test("a semi-open pair's are on its two vars", () => {
    expect(element(xml, 'varGrp', 'VG_so')).not.toContain('<concept');
    expect(element(xml, 'var', 'V_so')).toContain('<concept>Choice</concept>');
    expect(element(xml, 'var', 'V_so_other')).toContain(
      '<concept>Choice, other</concept>',
    );
  });

  test('comes after txt in a varGrp and before varFormat in a var (XSD order)', () => {
    expect(element(xml, 'varGrp', 'VG_g')).toMatch(/<txt>[^]*<concept>/);
    expect(element(xml, 'var', 'V_age')).toMatch(
      /<\/qstn>\s*<concept>[^]*<varFormat/,
    );
  });

  test('comes back as the column, and the codebook stays the same', () => {
    const back = ddiToXlsform(xml);
    const byName = Object.fromEntries(back.survey.map((r) => [r.name, r]));
    expect(byName['g']?.concept).toBe('Work');
    expect(byName['t']?.concept).toBe('Institutional trust');
    expect(byName['age']?.concept).toBe('Age in years');
    expect(byName['mm']?.concept).toBe('Media use');
    expect(byName['so_other']?.concept).toBe('Choice, other');
    expect(
      buildDdiXml(back.survey, back.choices, {
        prodDate: '2020-01-01',
        settings: back.settings[0] ?? {},
      }),
    ).toBe(xml);
  });
});

describe('languages', () => {
  test('concept::<lang> columns are xml:lang siblings', () => {
    const xml = build(
      [
        {
          type: 'integer',
          name: 'age',
          'label::Deutsch (de)': 'Alter',
          'label::English (en)': 'Age',
          'concept::Deutsch (de)': 'Lebensalter',
          'concept::English (en)': 'Age in years',
        },
      ],
      { default_language: 'Deutsch (de)' },
    );
    expect(xml).toContain(
      '<concept>Lebensalter</concept>\n      <concept xml:lang="en">Age in years</concept>',
    );
  });

  test('a concept only in another language has no empty base one', () => {
    const xml = build(
      [
        {
          type: 'integer',
          name: 'age',
          'label::Deutsch (de)': 'Alter',
          'label::English (en)': 'Age',
          'concept::English (en)': 'Age in years',
        },
      ],
      { default_language: 'Deutsch (de)' },
    );
    expect(element(xml, 'var', 'V_age')).toContain(
      '<concept xml:lang="en">Age in years</concept>',
    );
    expect(xml).not.toContain('<concept>');
  });
});

describe('select_*_from_file', () => {
  test('keeps concept/@vocab, with the column as its text', () => {
    const xml = build([
      {
        type: 'select_one_from_file iso_3166_1.csv',
        name: 'c1',
        label: 'Country',
      },
      {
        type: 'select_one_from_file iso_3166_1.csv',
        name: 'c2',
        label: 'Country',
        concept: 'Country of birth',
      },
    ]);
    expect(element(xml, 'var', 'V_c1')).toContain(
      '<concept vocab="iso_3166_1"/>',
    );
    expect(element(xml, 'var', 'V_c2')).toContain(
      '<concept vocab="iso_3166_1">Country of birth</concept>',
    );
    const back = ddiToXlsform(xml).survey;
    expect(back[0]).not.toHaveProperty('concept');
    expect(back[1]?.concept).toBe('Country of birth');
  });
});

describe('rows without a var', () => {
  test("a note's concept is kept as one of its columns", () => {
    const xml = build([
      { type: 'note', name: 'intro', label: 'Read this', concept: 'Intro' },
      { type: 'integer', name: 'age', label: 'Age' },
    ]);
    expect(xml).toContain(
      '<notes type="cdl:row_column" subject="intro concept">Intro</notes>',
    );
    expect(ddiToXlsform(xml).survey[0]?.concept).toBe('Intro');
  });
});

describe('DDI from elsewhere', () => {
  test('a concept is read into the column', () => {
    const back = ddiToXlsform(
      `<var ID="V_age" name="age" intrvl="contin" dcml="0">
        <qstn responseDomainType="numeric"><qstnLit>Age?</qstnLit></qstn>
        <concept>Age</concept>
      </var>`,
      { onWarning: () => {} },
    );
    expect(back.survey.find((r) => r.name === 'age')?.concept).toBe('Age');
  });
});

/** The codebook a form gives, and the form and codebook it gives back. */
function roundTrip(survey: Row[], settings: Row = {}) {
  const xml = build(survey, settings);
  const back = ddiToXlsform(xml);
  const again = buildDdiXml(back.survey, back.choices, {
    prodDate: '2020-01-01',
    settings: back.settings[0] ?? {},
  });
  return { xml, back: back.survey, again };
}

describe('semi-open select_multiple', () => {
  test('its concept is on the other varGrp, none on the _choices one', () => {
    const { xml, back, again } = roundTrip([
      {
        type: 'select_multiple m',
        name: 'mo',
        label: 'Media',
        concept: 'Media use',
      },
      { type: 'text', name: 'mo_other', label: 'Other media' },
    ]);
    expect(element(xml, 'varGrp', 'VG_mo')).toContain(
      '<concept>Media use</concept>',
    );
    expect(element(xml, 'varGrp', 'VG_mo_choices')).not.toContain('<concept');
    expect(back.find((r) => r.name === 'mo')?.concept).toBe('Media use');
    expect(again).toBe(xml);
  });

  test('with the or_other shorthand, the same', () => {
    const { xml, back, again } = roundTrip([
      {
        type: 'select_multiple n or_other',
        name: 'mo',
        label: 'Media',
        concept: 'Media use',
      },
    ]);
    expect(element(xml, 'varGrp', 'VG_mo')).toContain(
      '<concept>Media use</concept>',
    );
    expect(element(xml, 'varGrp', 'VG_mo_choices')).not.toContain('<concept');
    // The added companion has no row, so no concept.
    expect(element(xml, 'var', 'V_mo_other')).not.toContain('<concept');
    expect(back.find((r) => r.name === 'mo')?.concept).toBe('Media use');
    expect(again).toBe(xml);
  });
});

describe('or_other shorthand on a select_one', () => {
  test("the concept is the select's, the added companion has none", () => {
    const { xml, back, again } = roundTrip([
      {
        type: 'select_one n or_other',
        name: 'so',
        label: 'One',
        concept: 'Choice',
      },
    ]);
    expect(element(xml, 'var', 'V_so')).toContain('<concept>Choice</concept>');
    expect(element(xml, 'var', 'V_so_other')).not.toContain('<concept');
    expect(back.find((r) => r.name === 'so')?.concept).toBe('Choice');
    expect(again).toBe(xml);
  });
});

describe('select_*_from_file with concept translations', () => {
  const settings = { default_language: 'Deutsch (de)' };
  const base = {
    type: 'select_one_from_file iso_3166_1.csv',
    name: 'land',
    'label::Deutsch (de)': 'Land',
    'label::English (en)': 'Country',
  };

  test('@vocab is on the untagged first concept only', () => {
    const { xml, again } = roundTrip(
      [
        {
          ...base,
          'concept::Deutsch (de)': 'Herkunft',
          'concept::English (en)': 'Origin',
        },
      ],
      settings,
    );
    expect(element(xml, 'var', 'V_land')).toContain(
      '<concept vocab="iso_3166_1">Herkunft</concept>\n' +
        '      <concept xml:lang="en">Origin</concept>',
    );
    expect(again).toBe(xml);
  });

  test('without a base-language concept, on an empty first one', () => {
    const { xml, back, again } = roundTrip(
      [{ ...base, 'concept::English (en)': 'Origin' }],
      settings,
    );
    expect(element(xml, 'var', 'V_land')).toContain(
      '<concept vocab="iso_3166_1"/>\n' +
        '      <concept xml:lang="en">Origin</concept>',
    );
    expect(back[0]?.type).toBe('select_one_from_file iso_3166_1.csv');
    expect(back[0]?.concept).toEqual({ 'English (en)': 'Origin' });
    expect(again).toBe(xml);
  });
});

describe('a matrix header', () => {
  test('has no var: its concept is a cdl:row_column', () => {
    const { xml, back } = roundTrip([
      {
        type: 'select_one m',
        name: 'hdr',
        label: 'Scale',
        appearance: 'label',
        concept: 'Header',
      },
      {
        type: 'select_one m',
        name: 'r1',
        label: 'Row 1',
        appearance: 'list-nolabel',
      },
    ]);
    expect(xml).toContain(
      '<notes type="cdl:row_column" subject="hdr concept">Header</notes>',
    );
    expect(back.find((r) => r.name === 'hdr')?.concept).toBe('Header');
  });
});
