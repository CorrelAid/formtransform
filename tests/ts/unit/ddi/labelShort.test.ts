/**
 * A short label on a question group (#181): the optional `label_short`
 * column (`label_short::<lang>` per language) is the `<labl>` of the varGrp
 * a row becomes (a group's section or grid, a select_multiple, a semi-open
 * question), before its `txt`, and `ddi2xlsform` gives it back. On a row
 * that is no varGrp it is one of the row's columns: CDL keeps labl off var.
 */
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import { ddiToXlsform } from '../../../../src/pipelines/ddi2xlsform/index.js';
import { xlsformToDdi } from '../../../../src/index.js';

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

const SURVEY: Row[] = [
  { type: 'begin_group', name: 'g', label: 'Group', label_short: 'G1' },
  { type: 'integer', name: 'age', label: 'Age', label_short: 'Q1' },
  { type: 'note', name: 'n1', label: 'Read this', label_short: 'N' },
  {
    type: 'select_multiple m',
    name: 'mm',
    label: 'Media',
    label_short: 'Q2',
  },
  { type: 'text', name: 'mm_other', label: 'Other media' },
  { type: 'select_multiple n', name: 'plain', label: 'P', label_short: 'Q3' },
  {
    type: 'select_one n or_other',
    name: 'so',
    label: 'One',
    label_short: 'Q4',
  },
  { type: 'select_one m', name: 'pair', label: 'Pair', label_short: 'Q5' },
  { type: 'text', name: 'pair_other', label: 'Which?' },
  { type: 'end_group' },
  {
    type: 'begin_group',
    name: 'attari',
    label: 'How much do you agree?',
    appearance: 'table-list',
    label_short: 'ATTARI-12',
  },
  { type: 'select_one n', name: 't1', label: 'Row 1' },
  { type: 'select_one n', name: 't2', label: 'Row 2' },
  { type: 'end_group' },
];

describe('label_short', () => {
  const xml = build(SURVEY);

  test("is the labl of a group's varGrp, before its txt", () => {
    expect(element(xml, 'varGrp', 'VG_g')).toMatch(
      /^<varGrp [^>]*type="section"[^>]*>\s*<labl>G1<\/labl>\s*<txt>Group<\/txt>/,
    );
    expect(element(xml, 'varGrp', 'VG_attari')).toMatch(
      /type="grid"[^>]*>\s*<labl>ATTARI-12<\/labl>\s*<txt>/,
    );
  });

  test("is the labl of a select_multiple's and a semi-open question's varGrp", () => {
    expect(element(xml, 'varGrp', 'VG_plain')).toMatch(
      /type="multipleResp"[^>]*>\s*<labl>Q3<\/labl>\s*<txt>P<\/txt>/,
    );
    // A semi-open select_multiple: on the pair, not its multipleResp child.
    expect(element(xml, 'varGrp', 'VG_mm')).toMatch(
      /type="other"[^>]*>\s*<labl>Q2<\/labl>\s*<txt>Media<\/txt>/,
    );
    expect(element(xml, 'varGrp', 'VG_mm_choices')).not.toContain('<labl>');
    expect(element(xml, 'varGrp', 'VG_so')).toMatch(
      /type="other"[^>]*>\s*<labl>Q4<\/labl>/,
    );
    expect(element(xml, 'varGrp', 'VG_pair')).toMatch(
      /type="other"[^>]*>\s*<labl>Q5<\/labl>/,
    );
  });

  test('is never on a var: elsewhere it is one of the row’s columns', () => {
    for (const m of xml.matchAll(/<var [\s\S]*?<\/var>/g)) {
      expect(m[0]).not.toMatch(/<labl>Q|<labl>N/);
    }
    expect(element(xml, 'var', 'V_age')).toContain(
      '<notes type="cdl:column" subject="label_short">Q1</notes>',
    );
    expect(xml).toContain(
      '<notes type="cdl:row_column" subject="n1 label_short">N</notes>',
    );
  });

  test('comes back in the same column, and the codebook again', () => {
    const back = ddiToXlsform(xml);
    const byName = (name: string) => back.survey.find((r) => r.name === name);
    expect(byName('g')).toMatchObject({ label_short: 'G1' });
    expect(byName('attari')).toMatchObject({ label_short: 'ATTARI-12' });
    expect(byName('age')).toMatchObject({ label_short: 'Q1' });
    expect(byName('n1')).toMatchObject({ label_short: 'N' });
    expect(byName('mm')).toMatchObject({ label_short: 'Q2' });
    expect(byName('plain')).toMatchObject({ label_short: 'Q3' });
    expect(byName('so')).toMatchObject({ label_short: 'Q4' });
    expect(byName('pair')).toMatchObject({ label_short: 'Q5' });
    expect(build(back.survey, back.settings[0] ?? {})).toBe(xml);
  });

  test('without the column there is no labl', () => {
    const plain = build(SURVEY.map(({ label_short: _, ...row }) => row));
    expect(plain).not.toContain('<labl>G');
    expect(element(plain, 'varGrp', 'VG_g')).not.toContain('<labl>');
  });
});

describe('label_short per language', () => {
  const survey: Row[] = [
    {
      type: 'begin_group',
      name: 'scale',
      appearance: 'table-list',
      'label::Deutsch (de)': 'Wie sehr stimmen Sie zu?',
      'label::English (en)': 'How much do you agree?',
      'label_short::Deutsch (de)': 'ATTARI-12 (de)',
      'label_short::English (en)': 'ATTARI-12',
    },
    { type: 'select_one n', name: 'r1', 'label::Deutsch (de)': 'Zeile' },
    { type: 'end_group' },
    {
      type: 'select_multiple m',
      name: 'media',
      'label::Deutsch (de)': 'Medien',
      // Only the second language has one.
      'label_short::English (en)': 'Media',
    },
  ];
  const settings = [{ default_language: 'Deutsch (de)' }];

  test('the base untagged and first, each other language a sibling', () => {
    const xml = buildDdiXml(survey, CHOICES, {
      prodDate: '2020-01-01',
      settings: settings[0],
    });
    expect(element(xml, 'varGrp', 'VG_scale')).toContain(
      '<labl>ATTARI-12 (de)</labl>\n' +
        '      <labl xml:lang="en">ATTARI-12</labl>\n' +
        '      <txt>Wie sehr stimmen Sie zu?</txt>',
    );
    expect(element(xml, 'varGrp', 'VG_media')).toMatch(
      /^<varGrp [^>]*>\s*<labl xml:lang="en">Media<\/labl>\s*<txt>Medien<\/txt>/,
    );
  });

  test('xlsformToDdi takes it from the sheets, and gives it back', () => {
    const quiet = () => {};
    const xml = xlsformToDdi(
      { surveyData: survey, choicesData: CHOICES, settingsData: settings },
      { onWarning: quiet },
    );
    expect(xml).toContain('<labl xml:lang="en">ATTARI-12</labl>');
    const back = ddiToXlsform(xml, { onWarning: quiet });
    const scale = back.survey.find((r) => r.name === 'scale');
    expect(Object.values(scale?.label_short as Row)).toEqual([
      'ATTARI-12 (de)',
      'ATTARI-12',
    ]);
  });

  test('is an expected survey column (no column-unexpected warning)', () => {
    const codes: string[] = [];
    xlsformToDdi(
      { surveyData: survey, choicesData: CHOICES, settingsData: settings },
      { onWarning: (w) => codes.push(w.message) },
    );
    expect(codes.filter((m) => m.includes('label_short'))).toEqual([]);
  });
});

describe('form_subtitle and form_title_short (#181)', () => {
  const survey = [
    {
      type: 'text',
      name: 't',
      'label::Deutsch (de)': 'T',
      'label::English (en)': 'T',
    },
  ];

  test('are subTitl and altTitl, in the XSD order, not cdl:setting notes', () => {
    const xml = buildDdiXml(survey, [], {
      prodDate: '2020-01-01',
      settings: {
        form_title: { 'Deutsch (de)': 'Befragung', 'English (en)': 'Survey' },
        form_subtitle: { 'Deutsch (de)': 'Welle 2', 'English (en)': 'Wave 2' },
        form_title_short: 'ATTARI',
        form_id: 'f1',
        default_language: 'Deutsch (de)',
      },
    });
    expect(xml).toContain(
      '<titl>Befragung</titl>\n' +
        '        <subTitl>Welle 2</subTitl>\n' +
        '        <subTitl xml:lang="en">Wave 2</subTitl>\n' +
        '        <altTitl>ATTARI</altTitl>\n' +
        '        <parTitl xml:lang="en">Survey</parTitl>\n' +
        '        <IDNo>f1</IDNo>',
    );
    expect(xml).not.toContain('subject="form_subtitle');
    expect(xml).not.toContain('subject="form_title_short');

    const back = ddiToXlsform(xml).settings[0];
    expect(back?.form_title_short).toBe('ATTARI');
    // Per language (keyed by tag, or by the form's name for it: #183).
    expect(Object.values(back?.form_subtitle as object)).toEqual([
      'Welle 2',
      'Wave 2',
    ]);
  });

  test('without them there is no subTitl or altTitl', () => {
    const xml = buildDdiXml(survey, [], { prodDate: '2020-01-01' });
    expect(xml).not.toMatch(/<subTitl|<altTitl/);
  });
});
