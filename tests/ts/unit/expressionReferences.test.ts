/** validateSubset: dangling references and impossible literals in relevant/constraint (#73). */
import { describe, test, expect } from 'vitest';

import { XLSValidator } from '../../../src/xlsform/validate.js';

type Row = Record<string, unknown>;

const choices = [
  { list_name: 'yn', name: 'yes', label: 'Ja' },
  { list_name: 'yn', name: 'no', label: 'Nein' },
];

const findings = (survey: Row[], c: Row[] = choices) =>
  XLSValidator.validateSubset(survey, c)
    .filter(
      (d) => d.code === 'reference-unknown' || d.code === 'literal-invalid',
    )
    .map((d) => ({ code: d.code, severity: d.severity, name: d.name }));

describe('relevant / constraint references', () => {
  test('no expression, no finding', () => {
    expect(
      findings([
        { type: 'select_one yn', name: 'q1', label: 'Q1?' },
        { type: 'text', name: 'q2', label: 'Q2?' },
      ]),
    ).toEqual([]);
  });

  test('valid references and literals give no finding', () => {
    expect(
      findings([
        { type: 'select_one yn', name: 'q1', label: 'Q1?' },
        { type: 'select_multiple yn', name: 'm', label: 'M?' },
        { type: 'integer', name: 'age', label: 'Alter?' },
        {
          type: 'text',
          name: 'q2',
          label: 'Q2?',
          relevant:
            "${q1} = 'yes' and selected(${m}, \"no\") and ${age} > 17 and 'no' != ${q1}",
          constraint: 'string-length(.) < 50',
        },
      ]),
    ).toEqual([]);
  });

  test('an unknown name is an error, once per name', () => {
    expect(
      findings([
        { type: 'select_one yn', name: 'q1', label: 'Q1?' },
        {
          type: 'text',
          name: 'q2',
          label: 'Q2?',
          relevant: "${gone} = 'yes' or ${gone} = 'no'",
        },
      ]),
    ).toEqual([{ code: 'reference-unknown', severity: 'error', name: 'q2' }]);
  });

  test('a literal outside the choices is a warning, in either shape', () => {
    const survey = [
      { type: 'select_one yn', name: 'q1', label: 'Q1?' },
      { type: 'select_multiple yn', name: 'm', label: 'M?' },
      { type: 'text', name: 'a', label: 'A?', relevant: "${q1} = 'Ja'" },
      { type: 'text', name: 'b', label: 'B?', relevant: "selected(${m}, 'x')" },
      { type: 'text', name: 'c', label: 'C?', relevant: "'maybe' != ${q1}" },
    ];
    expect(findings(survey)).toEqual(
      ['a', 'b', 'c'].map((name) => ({
        code: 'literal-invalid',
        severity: 'warning',
        name,
      })),
    );
  });

  test("or_other adds the 'other' code", () => {
    expect(
      findings([
        { type: 'select_one yn or_other', name: 'q1', label: 'Q1?' },
        {
          type: 'text',
          name: 'q1_other',
          label: 'Welche?',
          relevant: "${q1} = 'other'",
        },
      ]),
    ).toEqual([]);
  });

  test('a quoted non-number against a numeric question is a warning', () => {
    const survey = [
      { type: 'integer', name: 'age', label: 'Alter?' },
      { type: 'text', name: 'a', label: 'A?', relevant: "${age} = 'old'" },
      { type: 'text', name: 'b', label: 'B?', relevant: "${age} = '18'" },
    ];
    expect(findings(survey).map((f) => f.name)).toEqual(['a']);
  });

  test('registered vocabulary codes count as choices', () => {
    const survey = [
      {
        type: 'select_one_from_file iso_3166_1.csv',
        name: 'land',
        label: 'Land?',
      },
      { type: 'text', name: 'a', label: 'A?', relevant: "${land} = 'DE'" },
      { type: 'text', name: 'b', label: 'B?', relevant: "${land} = 'XX'" },
    ];
    expect(findings(survey, []).map((f) => f.name)).toEqual(['b']);
  });

  test('the formulaid#47 shape: a follow-up keyed on the label, not the code', () => {
    const survey = [
      { type: 'select_one art', name: 'art', label: 'Welche Art?' },
      {
        type: 'text',
        name: 'art_sonst',
        label: 'Welche?',
        relevant: "${art} = 'Sonstiges'",
      },
    ];
    const c = [
      { list_name: 'art', name: 'verein', label: 'Verein' },
      { list_name: 'art', name: 'sonstiges', label: 'Sonstiges' },
    ];
    expect(findings(survey, c)).toEqual([
      { code: 'literal-invalid', severity: 'warning', name: 'art_sonst' },
    ]);
  });
});
