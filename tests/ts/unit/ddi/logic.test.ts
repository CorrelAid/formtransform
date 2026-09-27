/**
 * Skip logic and validation in the DDI (#151, convention:logicMapping
 * `ddiEncoding`): `<universe>` prose and `<valrng>` for readers, typed
 * `cdl:` notes with the exact expression for the way back.
 */
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import { lstsvToDdiXml } from '../../../../src/pipelines/lstsv2ddi/index.js';
import { simpleRange } from '../../../../src/ddi/logic.js';

const OPTS = { prodDate: '2020-01-01' };

const YN = [
  { list_name: 'yn', name: 'yes', label: 'Yes' },
  { list_name: 'yn', name: 'no', label: 'No' },
];

/** The `<var name="…">` element's XML. */
function varXml(xml: string, name: string): string {
  const start = xml.indexOf(`<var ID="V_${name}"`);
  return xml.slice(start, xml.indexOf('</var>', start));
}

function escapeXml(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ddi(rows: Record<string, unknown>[], settings = {}): string {
  return buildDdiXml(rows, YN, { ...OPTS, settings });
}

describe('relevant', () => {
  test('a universe sentence and the exact expression as a typed note', () => {
    const xml = ddi([
      { type: 'select_one yn', name: 'dog', label: 'Do you have a dog?' },
      {
        type: 'text',
        name: 'dogname',
        label: 'Its name?',
        relevant: "${dog} = 'yes'",
      },
    ]);
    const v = varXml(xml, 'dogname');
    expect(v).toContain(
      '<universe clusion="I">Only if “Do you have a dog?” = Yes</universe>',
    );
    expect(v).toContain(
      `<notes type="cdl:relevant" subject="xlsform-xpath">\${dog} = 'yes'</notes>`,
    );
    // XSD order: qstn, universe, …, concept, varFormat, notes.
    expect(v.indexOf('</qstn>')).toBeLessThan(v.indexOf('<universe'));
    expect(v.indexOf('<varFormat')).toBeLessThan(v.indexOf('<notes'));
  });

  test.each([
    ['${n} >= 18 and ${n} != 99', 'Only if “Age” ≥ 18 and “Age” ≠ 99'],
    [
      '${n} < 18 or (${n} > 65 and ${n} < 90)',
      'Only if “Age” < 18 or (“Age” > 65 and “Age” < 90)',
    ],
    ['18 <= ${n}', 'Only if “Age” ≥ 18'],
    ["${n} != ''", 'Only if “Age” is answered'],
    ["${n} = ''", 'Only if “Age” is not answered'],
    ['not(${n} > 3)', 'Only if not (“Age” > 3)'],
  ])('%s', (relevant, prose) => {
    const xml = ddi([
      { type: 'integer', name: 'n', label: 'Age' },
      { type: 'text', name: 't', label: 'T', relevant },
    ]);
    expect(varXml(xml, 't')).toContain(`>${escapeXml(prose)}</universe>`);
  });

  test('selected() on a select_multiple reads as "includes"', () => {
    const xml = ddi([
      { type: 'select_multiple yn', name: 'm', label: 'Which?' },
      {
        type: 'text',
        name: 't',
        label: 'T',
        relevant: "selected(${m}, 'no')",
      },
    ]);
    expect(varXml(xml, 't')).toContain('Only if “Which?” includes No');
  });

  test('outside the prose: no universe, the note still carries it', () => {
    const xml = ddi([
      { type: 'text', name: 'a', label: 'A' },
      {
        type: 'text',
        name: 't',
        label: 'T',
        relevant: 'string-length(${a}) > 3',
      },
    ]);
    const v = varXml(xml, 't');
    expect(v).not.toContain('<universe');
    expect(v).toContain('string-length(${a}) &gt; 3</notes>');
  });

  test("a group's condition is on its section; the universe states both", () => {
    const xml = ddi([
      { type: 'select_one yn', name: 'dog', label: 'Dog?' },
      {
        type: 'begin_group',
        name: 'g',
        label: 'G',
        relevant: "${dog} = 'yes'",
      },
      { type: 'integer', name: 'age', label: 'Age' },
      { type: 'text', name: 't', label: 'T', relevant: '${age} > 1' },
      { type: 'end_group' },
    ]);
    const section = xml.slice(
      xml.indexOf('<varGrp ID="VG_g"'),
      xml.indexOf('</varGrp>'),
    );
    expect(section).toContain('type="section" var="V_age V_t"');
    expect(section).toContain('Only if “Dog?” = Yes</universe>');
    expect(section).toContain(
      `subject="xlsform-xpath">\${dog} = 'yes'</notes>`,
    );
    // A member's note is its own condition only.
    expect(varXml(xml, 'age')).not.toContain('<notes');
    expect(varXml(xml, 'age')).toContain('Only if “Dog?” = Yes</universe>');
    expect(varXml(xml, 't')).toContain(
      `subject="xlsform-xpath">\${age} &gt; 1</notes>`,
    );
    expect(varXml(xml, 't')).toContain(
      'Only if “Dog?” = Yes and “Age” &gt; 1</universe>',
    );
  });

  test("a select_multiple's logic is on its varGrp, the prose also on each binary var", () => {
    const xml = ddi([
      { type: 'integer', name: 'n', label: 'N' },
      {
        type: 'select_multiple yn',
        name: 'm',
        label: 'Which?',
        relevant: '${n} > 1',
        required: 'yes',
      },
    ]);
    const grp = xml.slice(
      xml.indexOf('<varGrp ID="VG_m"'),
      xml.indexOf('</varGrp>'),
    );
    expect(grp).toContain(
      '<universe clusion="I">Only if “N” &gt; 1</universe>',
    );
    expect(grp).toContain('<notes type="cdl:relevant"');
    expect(grp).toContain('<notes type="cdl:required">yes</notes>');
    expect(varXml(xml, 'm_yes')).toContain('<universe');
    expect(varXml(xml, 'm_yes')).not.toContain('<notes');
  });

  test("or_other's companion is asked when other is chosen", () => {
    const xml = ddi([
      { type: 'select_one yn or_other', name: 'src', label: 'Source?' },
    ]);
    expect(varXml(xml, 'src_other')).toContain(
      `subject="xlsform-xpath">\${src} = 'other'</notes>`,
    );
  });
});

describe('multilingual prose', () => {
  const rows = [
    {
      type: 'select_one yn',
      name: 'dog',
      'label::Deutsch (de)': 'Hund?',
      'label::English (en)': 'Dog?',
    },
    {
      type: 'text',
      name: 't',
      'label::Deutsch (de)': 'Name?',
      'label::English (en)': 'Name?',
      relevant: "${dog} = 'yes'",
    },
  ];
  const choices = [
    {
      list_name: 'yn',
      name: 'yes',
      'label::Deutsch (de)': 'Ja',
      'label::English (en)': 'Yes',
    },
  ];

  test('one universe per language with a template, in its own labels', () => {
    const xml = buildDdiXml(rows, choices, {
      ...OPTS,
      settings: { default_language: 'Deutsch (de)' },
    });
    const v = varXml(xml, 't');
    expect(v).toContain(
      '<universe clusion="I">Nur wenn „Hund?“ = Ja</universe>',
    );
    expect(v).toContain(
      '<universe clusion="I" xml:lang="en">Only if “Dog?” = Yes</universe>',
    );
  });

  test('a language lacking a label it needs gets no universe', () => {
    const xml = buildDdiXml(
      rows,
      [{ list_name: 'yn', name: 'yes', 'label::Deutsch (de)': 'Ja' }],
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    const v = varXml(xml, 't');
    expect(v).toContain('Nur wenn');
    expect(v).not.toContain('Only if');
  });

  test('constraint_message: one note per language', () => {
    const xml = buildDdiXml(
      [
        {
          type: 'integer',
          name: 'n',
          'label::Deutsch (de)': 'Zahl',
          'label::English (en)': 'Number',
          constraint: '. > 0',
          'constraint_message::Deutsch (de)': 'Positiv',
          'constraint_message::English (en)': 'Positive',
        },
      ],
      [],
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    const v = varXml(xml, 'n');
    expect(v).toContain('<notes type="cdl:constraint_message">Positiv</notes>');
    expect(v).toContain(
      '<notes type="cdl:constraint_message" xml:lang="en">Positive</notes>',
    );
  });
});

describe('constraint', () => {
  test.each([
    ['. >= 1 and . <= 10', { min: '1', max: '10' }],
    ['. > 0', { minExclusive: '0' }],
    ['100 > .', { maxExclusive: '100' }],
    ['. >= -5', { min: '-5' }],
    ['. >= 1 and . >= 2', null],
    ['. >= 1 or . <= 10', null],
    ['. != 3', null],
    ['string-length(.) < 5', null],
  ])('simpleRange(%s)', (constraint, range) => {
    expect(simpleRange(constraint)).toEqual(range);
  });

  test('a simple range on a number is also a valrng, before universe', () => {
    const xml = ddi([
      { type: 'integer', name: 'k', label: 'K' },
      {
        type: 'integer',
        name: 'n',
        label: 'N',
        constraint: '. >= 1 and . <= 10',
        relevant: '${k} > 0',
      },
    ]);
    const v = varXml(xml, 'n');
    expect(v).toContain('<valrng>\n        <range min="1" max="10"/>');
    expect(v.indexOf('<valrng')).toBeLessThan(v.indexOf('<universe'));
  });

  test('a text has no valrng, only the note', () => {
    const xml = ddi([
      { type: 'text', name: 't', label: 'T', constraint: '. > 0' },
    ]);
    const v = varXml(xml, 't');
    expect(v).not.toContain('<valrng');
    expect(v).toContain('<notes type="cdl:constraint"');
  });

  test('no constraint, no constraint_message note', () => {
    const xml = ddi([
      { type: 'text', name: 't', label: 'T', constraint_message: 'Oops' },
    ]);
    expect(varXml(xml, 't')).not.toContain('cdl:constraint_message');
  });
});

describe('lstsv → DDI logic', () => {
  const header = [
    'class',
    'type/scale',
    'name',
    'relevance',
    'text',
    'help',
    'language',
    'mandatory',
    'em_validation_q',
  ].join('\t');
  const line = (...cells: string[]) => cells.join('\t');

  test('relevance is reversed into XPath', () => {
    const tsv = [
      header,
      line('S', '', 'language', '1', 'en', '', '', '', ''),
      line('G', '1', 'G', '1', '', '', 'en', '', ''),
      line('Q', 'N', 'age', '1', 'Age?', '', 'en', 'Y', ''),
      line('Q', 'S', 'job', 'age > 17', 'Job?', '', 'en', 'N', ''),
    ].join('\n');
    const xml = lstsvToDdiXml(tsv, OPTS);
    expect(varXml(xml, 'job')).toContain(
      'subject="xlsform-xpath">${age} &gt; 17</notes>',
    );
    expect(varXml(xml, 'age')).toContain(
      '<notes type="cdl:required">yes</notes>',
    );
  });

  test('an expression outside the dialect: a warning, no note', () => {
    const tsv = [
      header,
      line('S', '', 'language', '1', 'en', '', '', '', ''),
      line('G', '1', 'G', '1', '', '', 'en', '', ''),
      line('Q', 'S', 'job', 'strtoupper(x) == "A"', 'Job?', '', 'en', 'N', ''),
    ].join('\n');
    const warnings: string[] = [];
    const xml = lstsvToDdiXml(tsv, {
      ...OPTS,
      onWarning: (w) => warnings.push(w.code),
    });
    expect(varXml(xml, 'job')).not.toContain('cdl:relevant');
    expect(warnings).toEqual(['em-unsupported']);
  });
});
