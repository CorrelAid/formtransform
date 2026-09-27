/**
 * The form's structure in the DDI (#152): every group a `<varGrp>` (a plain
 * one `type="section"`), nested by `@varGrp`, and the `<var>`s in survey
 * order.
 */
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import { getDdiColumnNames } from '../../../../src/ddi/data.js';
import { extractVariables } from '../../../../src/pipelines/xlsform2ddi/variables.js';

const OPTS = { prodDate: '2020-01-01' };

const CHOICES = [
  { list_name: 'yn', name: 'yes', label: 'Yes' },
  { list_name: 'yn', name: 'no', label: 'No' },
];

const SURVEY = [
  { type: 'text', name: 'first', label: 'First' },
  { type: 'begin_group', name: 'outer', label: 'Outer' },
  { type: 'select_multiple yn', name: 'm', label: 'M' },
  { type: 'begin_group', name: 'inner', label: 'Inner' },
  { type: 'integer', name: 'n', label: 'N' },
  { type: 'select_one yn or_other', name: 'o', label: 'O' },
  { type: 'end_group' },
  {
    type: 'begin_group',
    name: 'grid',
    label: 'Grid',
    appearance: 'table-list',
  },
  { type: 'select_one yn', name: 'g1', label: 'G1' },
  { type: 'select_one yn', name: 'g2', label: 'G2' },
  { type: 'end_group' },
  { type: 'end_group' },
  { type: 'begin_group', name: 'empty', label: 'Only a note' },
  { type: 'note', name: 'hello', label: 'Hello' },
  { type: 'end_group' },
  { type: 'date', name: 'last', label: 'Last' },
];

function varGrp(xml: string, id: string): string {
  const start = xml.indexOf(`<varGrp ID="${id}"`);
  return start < 0 ? '' : xml.slice(start, xml.indexOf('</varGrp>', start));
}

const xml = buildDdiXml(SURVEY, CHOICES, OPTS);

describe('groups', () => {
  test('a plain group is a section listing its direct members', () => {
    expect(varGrp(xml, 'VG_outer')).toContain(
      '<varGrp ID="VG_outer" name="outer" type="section" varGrp="VG_m VG_outer_inner VG_outer_grid">',
    );
    expect(varGrp(xml, 'VG_outer_inner')).toContain(
      'name="outer/inner" type="section" var="V_n" varGrp="VG_o">',
    );
    expect(varGrp(xml, 'VG_outer_inner')).toContain('<txt>Inner</txt>');
    expect(varGrp(xml, 'VG_outer_inner')).toContain('<concept>Inner</concept>');
  });

  test('a grid stays a grid, inside its section', () => {
    expect(varGrp(xml, 'VG_outer_grid')).toContain(
      'type="grid" var="V_g1 V_g2"',
    );
  });

  test('a group without a variable under it has no varGrp', () => {
    expect(xml).not.toContain('VG_empty');
  });

  test('top-level questions are in no group', () => {
    expect(xml).not.toMatch(/var="[^"]*V_first/);
  });

  test('a section label in every language', () => {
    const bi = buildDdiXml(
      [
        {
          type: 'begin_group',
          name: 'p',
          'label::Deutsch (de)': 'Person',
          'label::English (en)': 'Person (en)',
        },
        {
          type: 'text',
          name: 'job',
          'label::Deutsch (de)': 'Beruf?',
          'label::English (en)': 'Job?',
        },
        { type: 'end_group' },
      ],
      [],
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    expect(varGrp(bi, 'VG_p')).toContain(
      '<txt>Person</txt>\n      <txt xml:lang="en">Person (en)</txt>',
    );
  });
});

describe('order', () => {
  const names = [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map(
    (m) => m[1],
  );
  const survey = [
    'first',
    'm_yes',
    'm_no',
    'n',
    'o',
    'o_other',
    'g1',
    'g2',
    'last',
  ];

  test('the vars follow the survey', () => {
    expect(names).toEqual(survey);
  });

  test('the data columns follow the vars', () => {
    const variables = extractVariables(
      SURVEY,
      Object.fromEntries(
        ['yn'].map((l) => [l, CHOICES.filter((c) => c.list_name === l)]),
      ),
    );
    expect(getDdiColumnNames(variables)).toEqual(survey);
  });
});
