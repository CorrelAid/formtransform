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
  test('identical category sets share one list', () => {
    const cat = `<catgry><catValu>y</catValu><labl>Yes</labl></catgry>`;
    const v = (n: string, s: number) =>
      `<var ID="V_${n}" name="${n}"><qstn responseDomainType="category" seqNo="${s}"><qstnLit>${n}</qstnLit></qstn>${cat}</var>`;
    const { instrument } = read(v('a', 1) + v('b', 2));
    expect(instrument.body.map((q) => (q as QuestionItem).list)).toEqual([
      'a',
      'a',
    ]);
    expect(Object.keys(instrument.lists)).toEqual(['a']);
  });
});
