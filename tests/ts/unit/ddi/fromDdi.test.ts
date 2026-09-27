/**
 * DDI → Instrument (#154) on input formtransform didn't write: fragments,
 * hand-written DDI, broken XML. The round trip itself is
 * `tests/ts/contract/ddiRoundtrip*.test.ts`.
 */
import { describe, test, expect } from 'vitest';

import type { Diagnostic } from '../../../../src/diagnostics.js';
import { ConversionError } from '../../../../src/diagnostics.js';
import { instrumentFromDdi } from '../../../../src/instrument/fromDdi.js';
import { ddiToXlsform } from '../../../../src/pipelines/ddi2xlsform/index.js';
import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';
import type { QuestionItem } from '../../../../src/instrument/types.js';
import { parseXml, textContent } from '../../../../src/utils/xmlParse.js';

function read(xml: string) {
  const warnings: Diagnostic[] = [];
  const instrument = instrumentFromDdi(xml, {
    onWarning: (w) => warnings.push(w),
  });
  return { instrument, warnings, codes: warnings.map((w) => w.code) };
}

const VAR = `<var ID="V_age" name="age" intrvl="contin" dcml="0">
  <qstn responseDomainType="numeric" seqNo="1"><qstnLit>Age?</qstnLit></qstn>
  <varFormat type="numeric" schema="other"/>
  <notes type="cdl:required">yes</notes>
</var>`;

describe('xmlParse', () => {
  test('entities, CDATA, comments, a declaration and a BOM', () => {
    const [root] = parseXml(
      '﻿<?xml version="1.0"?><!-- c --><a x="1 &amp; 2">&lt;b&gt; &#228;&#xE4;<![CDATA[<raw>]]></a>',
    );
    expect(root.attrs['x']).toBe('1 & 2');
    expect(root.text).toBe('<b> ää<raw>');
  });

  test('mixed content in document order; prefixes dropped from names', () => {
    const [root] = parseXml(
      '<ddi:qstnLit>Do you <xhtml:b>really</xhtml:b> agree?</ddi:qstnLit>',
    );
    expect(root.name).toBe('qstnLit');
    expect(textContent(root)).toBe('Do you really agree?');
  });

  test.each(['<a><b></a>', '<a', '<a>text'])('%s is ddi-invalid', (xml) => {
    expect(() => parseXml(xml)).toThrow(
      expect.objectContaining({ code: 'ddi-invalid' }),
    );
  });
});

describe('fragments', () => {
  test('a bare <var>', () => {
    const { instrument, codes } = read(VAR);
    const q = instrument.body[0] as QuestionItem;
    expect(q).toMatchObject({ name: 'age', type: 'integer', required: true });
    expect(q.label).toEqual({ '': 'Age?' });
    expect(codes).toEqual([]);
  });

  test('several <var>s and a <varGrp> without a root', () => {
    const { instrument } = read(
      `<varGrp ID="VG_g" name="g" type="section" var="V_age"><txt>G</txt></varGrp>${VAR}`,
    );
    expect(instrument.body).toMatchObject([
      { kind: 'group', name: 'g', children: [{ name: 'age' }] },
    ]);
  });

  test('a varGrp pointing outside the fragment: ddi-reference-outside', () => {
    const { codes, warnings } = read(
      `<varGrp ID="VG_g" name="g" type="section" var="V_age V_gone"/>${VAR}`,
    );
    expect(codes).toEqual(['ddi-reference-outside']);
    expect(warnings[0].message).toContain('V_gone');
  });

  test('neither a codeBook nor a var: ddi-invalid', () => {
    expect(() => instrumentFromDdi('<stdyDscr/>')).toThrow(ConversionError);
  });
});

describe('DDI formtransform did not write', () => {
  const HAND = `<codeBook xmlns="ddi:codebook:2_5" version="2.5">
    <stdyDscr><citation><titlStmt><titl>Seed study</titl></titlStmt></citation></stdyDscr>
    <dataDscr>
      <var ID="V1" name="trust" intrvl="discrete">
        <qstn responseDomainType="category"><qstnLit>Trust?</qstnLit></qstn>
        <universe>Only adults</universe>
        <catgry><catValu>1</catValu><labl>Low</labl></catgry>
        <catgry><catValu>2</catValu><labl>High</labl></catgry>
      </var>
      <var ID="V2" name="odd"><qstn responseDomainType="geo"><qstnLit>Where?</qstnLit></qstn></var>
    </dataDscr>
  </codeBook>`;

  test('read as far as standard DDI goes, one warning per missing field', () => {
    const { instrument, codes } = read(HAND);
    expect(instrument.settings['form_title']).toBe('Seed study');
    expect(instrument.body[0]).toMatchObject({
      name: 'trust',
      type: 'select_one',
      list: 'trust',
    });
    expect(instrument.lists['trust'].map((c) => c.name)).toEqual(['1', '2']);
    expect(codes.filter((c) => c === 'ddi-field-missing').length).toBe(6);
  });

  test('an unknown response domain is text: ddi-type-unknown', () => {
    const { instrument, codes } = read(HAND);
    expect(instrument.body[1]).toMatchObject({ name: 'odd', type: 'text' });
    expect(codes).toContain('ddi-type-unknown');
  });

  test('ddiToXlsform gives the sheets', () => {
    const { survey, choices, settings } = ddiToXlsform(HAND);
    expect(survey.map((r) => r.type)).toEqual(['select_one trust', 'text']);
    expect(choices.map((c) => c.name)).toEqual(['1', '2']);
    expect(settings).toEqual([{ form_title: 'Seed study' }]);
  });
});

describe('choice lists', () => {
  const cat = `<catgry><catValu>y</catValu><labl>Yes</labl></catgry>`;
  const v = (n: string, extra = '') =>
    `<var ID="V_${n}" name="${n}"><qstn responseDomainType="category"><qstnLit>${n}</qstnLit></qstn>${cat}${extra}</var>`;
  const lists = (xml: string) => {
    const { instrument } = read(xml);
    return {
      used: instrument.body.map((q) => (q as QuestionItem).list),
      names: Object.keys(instrument.lists),
    };
  };

  test('in DDI not from CDL, identical category sets share one list', () => {
    expect(lists(v('a') + v('b'))).toEqual({
      used: ['a', 'a'],
      names: ['a'],
    });
  });

  test("in a CDL codebook, a list is cdl:list's, else the question's (#160)", () => {
    const named = '<notes type="cdl:list">yn</notes>';
    expect(lists(v('a', named) + v('b', named) + v('c'))).toEqual({
      used: ['yn', 'yn', 'c'],
      names: ['yn', 'c'],
    });
  });
});

describe('cells as authored (#160)', () => {
  const back = (survey: Record<string, unknown>[]) =>
    ddiToXlsform(buildDdiXml(survey, [], { prodDate: '2020-01-01' })).survey;

  test('a required cell other than yes', () => {
    expect(
      back([{ type: 'text', name: 't', label: 'T', required: 'TRUE' }])[0],
    ).toMatchObject({ required: 'TRUE' });
  });

  test('a group without a label has none', () => {
    const [group] = back([
      { type: 'begin_group', name: 'g' },
      { type: 'text', name: 't', label: 'T' },
      { type: 'end_group' },
    ]);
    expect(group).toMatchObject({ type: 'begin_group', name: 'g', label: '' });
  });

  test('notes the blank lines can not tell apart keep their own texts', () => {
    const survey = back([
      { type: 'note', name: 'a', label: 'One\n\nTwo' },
      { type: 'note', name: 'b', label: 'Three' },
      { type: 'text', name: 't', label: 'T' },
    ]);
    expect(survey.slice(0, 2)).toEqual([
      { type: 'note', name: 'a', label: 'One\n\nTwo' },
      { type: 'note', name: 'b', label: 'Three' },
    ]);
  });
});

describe("columns the model doesn't lift (#160)", () => {
  const survey = [
    { type: 'begin_group', name: 'g', label: 'G', intent: 'field-list' },
    {
      type: 'select_one yn',
      name: 'q',
      label: 'Q',
      choice_filter: "f = 'a'",
      'media::image::Deutsch (de)': 'q.png',
    },
    { type: 'note', name: 'n', label: 'N', 'media::audio': 'n.mp3' },
    { type: 'end_group' },
  ];
  const choices = [
    {
      list_name: 'yn',
      name: 'y',
      label: 'Yes',
      f: 'a',
      'media::image': 'y.png',
    },
    { list_name: 'yn', name: 'n', label: 'No' },
  ];
  const xml = buildDdiXml(survey, choices, { prodDate: '2020-01-01' });

  test('are cdl:column, cdl:choice_column and cdl:row_column notes', () => {
    expect(xml).toContain(
      `<notes type="cdl:column" subject="choice_filter">f = 'a'</notes>`,
    );
    expect(xml).toContain(
      '<notes type="cdl:column" subject="media::image::Deutsch (de)">q.png</notes>',
    );
    expect(xml).toContain(
      '<notes type="cdl:choice_column" subject="y media::image">y.png</notes>',
    );
    expect(xml).toContain(
      '<notes type="cdl:row_column" subject="n media::audio">n.mp3</notes>',
    );
    expect(xml).toContain(
      '<notes type="cdl:column" subject="intent">field-list</notes>',
    );
  });

  test('come back as the form had them', () => {
    const back = ddiToXlsform(xml);
    expect(back.survey[0]).toMatchObject({ intent: 'field-list' });
    expect(back.survey[1]).toMatchObject({
      choice_filter: "f = 'a'",
      'media::image::Deutsch (de)': 'q.png',
    });
    expect(back.survey[2]).toMatchObject({
      name: 'n',
      'media::audio': 'n.mp3',
    });
    expect(back.choices[0]).toMatchObject({ f: 'a', 'media::image': 'y.png' });
  });
});

describe('the last cells (#160)', () => {
  const back = (
    survey: Record<string, unknown>[],
    settings: Record<string, unknown> = {},
  ) =>
    ddiToXlsform(buildDdiXml(survey, [], { prodDate: '2020-01-01', settings }));

  test('an empty group keeps its place', () => {
    const { survey } = back([
      { type: 'text', name: 'a', label: 'A' },
      { type: 'begin_group', name: 'empty', label: 'Empty' },
      { type: 'end_group' },
      { type: 'text', name: 'b', label: 'B' },
    ]);
    expect(survey.map((r) => r.name ?? r.type)).toEqual([
      'a',
      'empty',
      'end_group',
      'b',
    ]);
  });

  test("an end_group row's cells", () => {
    const { survey } = back([
      { type: 'begin_group', name: 'g', label: 'G' },
      { type: 'text', name: 'a', label: 'A' },
      { type: 'end_group', name: 'g', $kuid: 'k1' },
    ]);
    expect(survey[2]).toEqual({ type: 'end_group', name: 'g', $kuid: 'k1' });
  });

  test("an appearance's case", () => {
    const { survey } = back([
      { type: 'text', name: 'a', label: 'A', appearance: 'Multiline' },
    ]);
    expect(survey[0]).toMatchObject({ appearance: 'Multiline' });
  });

  test('a setting per language, and a boolean one', () => {
    const { settings } = back([{ type: 'text', name: 'a', label: 'A' }], {
      instance_name: { de: 'Name', en: 'Name (en)' },
      allow_choice_duplicates: true,
    });
    expect(settings[0]).toMatchObject({
      'instance_name::de': 'Name',
      'instance_name::en': 'Name (en)',
      allow_choice_duplicates: 'true',
    });
  });
});
