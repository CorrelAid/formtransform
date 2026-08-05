/** DDI document construction — study metadata, file description, variables. */
import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../pipelines/xlsform2ddi/index.js';

type Row = Record<string, unknown>;
type Choices =
  Row[] | Record<string, Array<{ name?: unknown; label?: unknown }>>;

function build(survey: Row[], choices: Choices = [], options = {}): string {
  return buildDdiXml(survey, choices, options);
}

/** Count non-overlapping occurrences of a substring. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('study description', () => {
  test('uses assetName as the title', () => {
    const xml = build([], [], { assetName: 'My Survey' });
    expect(xml).toContain('<titl>My Survey</titl>');
  });

  test('falls back to settings.form_title, then Untitled', () => {
    expect(
      build([], [], { settings: { form_title: 'From Settings' } }),
    ).toContain('<titl>From Settings</titl>');
    expect(build([])).toContain('<titl>Untitled</titl>');
  });

  test('emits IDNo only when id_string is set', () => {
    expect(build([], [], { settings: { id_string: 'S123' } })).toContain(
      '<IDNo>S123</IDNo>',
    );
    expect(build([])).not.toContain('<IDNo>');
  });

  test('emits a verStmt only when version is set', () => {
    const xml = build([], [], { settings: { version: 3 } });
    expect(xml).toContain('<verStmt>');
    expect(xml).toContain('<version>3</version>');
    expect(build([])).not.toContain('<verStmt>');
  });

  test('honours a prodDate override on both attribute and text', () => {
    expect(build([], [], { prodDate: '2020-01-02' })).toContain(
      '<prodDate date="2020-01-02">2020-01-02</prodDate>',
    );
  });
});

describe('file description', () => {
  test('caseQnty reflects the submission count', () => {
    expect(build([], [], { submissions: [{}, {}, {}] })).toContain(
      '<caseQnty>3</caseQnty>',
    );
    expect(build([])).toContain('<caseQnty>0</caseQnty>');
  });

  test('dataset filename drives fileDscr URI and fileName', () => {
    const xml = build([], [], { datasetFilename: 'responses.csv' });
    expect(xml).toContain('<fileDscr ID="F1" URI="responses.csv">');
    expect(xml).toContain('<fileName>responses.csv</fileName>');
  });
});

describe('standalone scalar variables', () => {
  test('integer → contin / numeric / numeric', () => {
    const xml = build([{ type: 'integer', name: 'age', label: 'Age' }]);
    expect(xml).toContain(
      '<var ID="V_age" name="age" intrvl="contin" files="F1">',
    );
    expect(xml).toContain('<qstn responseDomainType="numeric">');
    expect(xml).toContain('<varFormat type="numeric" schema="other"/>');
    expect(xml).toContain('<concept>Age</concept>');
  });

  test('text → discrete / text / character', () => {
    const xml = build([{ type: 'text', name: 't', label: 'Notes' }]);
    expect(xml).toContain('intrvl="discrete"');
    expect(xml).toContain('<qstn responseDomainType="text">');
    expect(xml).toContain('<varFormat type="character" schema="other"/>');
  });

  test('a variable without a label emits no qstn', () => {
    const xml = build([{ type: 'integer', name: 'x' }]);
    expect(xml).toContain('<var ID="V_x" name="x" intrvl="contin" files="F1">');
    expect(xml).not.toContain('<qstn');
  });
});

describe('select_one', () => {
  test('emits inline catgry with catValu + labl and category domain', () => {
    const xml = build([{ type: 'select_one c', name: 'q', label: 'Q' }], {
      c: [
        { name: '1', label: 'One' },
        { name: '2', label: 'Two' },
      ],
    });
    expect(xml).toContain('<qstn responseDomainType="category">');
    expect(xml).toContain('<catValu>1</catValu>');
    expect(xml).toContain('<labl>One</labl>');
    expect(count(xml, '<catgry>')).toBe(2);
    expect(xml).not.toContain('vocab=');
  });
});

describe('select_multiple → multipleResp expansion', () => {
  const xml = build(
    [{ type: 'select_multiple d', name: 'dev', label: 'Devices' }],
    {
      d: [
        { name: 'ph', label: 'Phone' },
        { name: 'pc', label: 'PC' },
      ],
    },
  );

  test('emits a multipleResp varGrp referencing per-choice binary vars', () => {
    expect(xml).toContain(
      '<varGrp ID="VG_dev" name="dev" type="multipleResp" var="V_dev_ph V_dev_pc">',
    );
  });

  test('each binary var has 0/1 categories without labels', () => {
    expect(xml).toContain(
      '<var ID="V_dev_ph" name="dev_ph" intrvl="discrete" files="F1">',
    );
    expect(xml).toContain('<qstn responseDomainType="multiple">');
    expect(xml).toContain('<preQTxt>Devices</preQTxt>');
    expect(xml).toContain('<qstnLit>Phone</qstnLit>');
    expect(xml).toContain('<catValu>0</catValu>');
    expect(xml).toContain('<catValu>1</catValu>');
    expect(xml).not.toContain('<labl>');
    expect(xml).toContain('<concept>Devices: Phone</concept>');
  });
});

describe('grid group (appearance table-list)', () => {
  const xml = build(
    [
      {
        type: 'begin_group',
        name: 'g',
        label: 'Trust',
        appearance: 'table-list',
      },
      { type: 'select_one s', name: 'a', label: 'Parliament' },
      { type: 'select_one s', name: 'b', label: 'Police' },
      { type: 'end_group' },
    ],
    {
      s: [
        { name: '1', label: 'Low' },
        { name: '2', label: 'High' },
      ],
    },
  );

  test('emits a grid varGrp listing member vars', () => {
    expect(xml).toContain(
      '<varGrp ID="VG_g" name="g" type="grid" var="V_a V_b">',
    );
    expect(xml).toContain('<txt>Trust</txt>');
  });

  test('each member carries the group label as preQTxt', () => {
    expect(count(xml, '<preQTxt>Trust</preQTxt>')).toBe(2);
    expect(xml).toContain('<qstnLit>Parliament</qstnLit>');
  });
});

describe('semi-open _other pattern', () => {
  test('select_one + _other → varGrp type other over both vars', () => {
    const xml = build(
      [
        { type: 'select_one src', name: 'how', label: 'How?' },
        { type: 'text', name: 'how_other', label: 'Other' },
      ],
      {
        src: [
          { name: 'web', label: 'Web' },
          { name: 'other', label: 'Other' },
        ],
      },
    );
    expect(xml).toContain(
      '<varGrp ID="VG_how" name="how" type="other" var="V_how V_how_other">',
    );
    // base retains all categories, incl. the "other" option
    expect(xml).toContain('<catValu>other</catValu>');
    // follow-up text var is standalone
    expect(xml).toContain(
      '<var ID="V_how_other" name="how_other" intrvl="discrete" files="F1">',
    );
  });

  test('select_multiple + _other → other parent with a child multipleResp', () => {
    const xml = build(
      [
        { type: 'select_multiple g', name: 'own', label: 'Own?' },
        { type: 'text', name: 'own_other', label: 'Other' },
      ],
      {
        g: [
          { name: 'a', label: 'A' },
          { name: 'other', label: 'Other' },
        ],
      },
    );
    expect(xml).toContain(
      '<varGrp ID="VG_own" name="own" type="other" var="V_own_other" varGrp="VG_own_choices">',
    );
    expect(xml).toContain(
      '<varGrp ID="VG_own_choices" name="own_choices" type="multipleResp" var="V_own_a">',
    );
    // no binary var for the "other" choice
    expect(xml).not.toContain(
      'V_own_other" name="own_other" intrvl="discrete" files="F1">\n      <qstn responseDomainType="multiple"',
    );
  });

  test('a trailing _other without an "other" choice is not treated as a pattern', () => {
    const xml = build(
      [
        { type: 'select_one src', name: 'how', label: 'How?' },
        { type: 'text', name: 'how_other', label: 'Other' },
      ],
      { src: [{ name: 'web', label: 'Web' }] },
    );
    expect(xml).not.toContain('type="other"');
  });
});

describe('external code list (select_*_from_file)', () => {
  test('emits concept @vocab and no inline catgry', () => {
    const xml = build([
      {
        type: 'select_one_from_file iso_3166_1.csv',
        name: 'country',
        label: 'Country',
      },
    ]);
    expect(xml).toContain('<concept vocab="iso_3166_1">Country</concept>');
    expect(xml).toContain('<qstn responseDomainType="category">');
    expect(xml).not.toContain('<catgry>');
  });
});

describe('notes', () => {
  test('a lone note yields a study-level notes element and empty dataDscr', () => {
    const xml = build([{ type: 'note', name: 'hint', label: 'Please read.' }]);
    expect(xml).toContain(
      '<notes type="instruction" subject="hint">Please read.</notes>',
    );
    expect(xml).toContain('<dataDscr/>');
  });

  test('an inline note becomes preQTxt on the following variable', () => {
    const xml = build([
      { type: 'note', name: 'n', label: 'Context' },
      { type: 'integer', name: 'q', label: 'Q' },
    ]);
    expect(xml).toContain('<preQTxt>Context</preQTxt>');
    expect(xml).not.toContain('<notes');
  });
});

describe('structure', () => {
  test('empty survey produces a self-closed dataDscr', () => {
    expect(build([])).toContain('<dataDscr/>');
  });

  test('group names with slashes are sanitized in the varGrp ID', () => {
    const xml = build(
      [
        {
          type: 'begin_group',
          name: 'outer',
          label: 'Outer',
          appearance: 'table-list',
        },
        {
          type: 'begin_group',
          name: 'inner',
          label: 'Inner',
          appearance: 'table-list',
        },
        { type: 'select_one s', name: 'a', label: 'A' },
        { type: 'end_group' },
        { type: 'end_group' },
      ],
      { s: [{ name: '1', label: 'One' }] },
    );
    expect(xml).toContain('ID="VG_outer_inner"');
    expect(xml).toContain('name="outer/inner"');
  });
});
