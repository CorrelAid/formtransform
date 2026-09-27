/**
 * The form's fields in the DDI (#153, convention:ddiFields): standard DDI
 * where it has a home, a typed `cdl:` note where it has none.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import conventions from '../../../../src/generated/conventions.js';
import { buildDdiXml } from '../../../../src/pipelines/xlsform2ddi/index.js';

const OPTS = { prodDate: '2020-01-01' };

const CHOICES = [
  { list_name: 'yn', name: 'yes', label: 'Yes' },
  { list_name: 'yn', name: 'no', label: 'No' },
  { list_name: 'yn', name: 'none', label: 'None', exclusive: 'yes' },
];

function varXml(xml: string, name: string): string {
  const start = xml.indexOf(`<var ID="V_${name}"`);
  return start < 0 ? '' : xml.slice(start, xml.indexOf('</var>', start));
}

function varGrp(xml: string, id: string): string {
  const start = xml.indexOf(`<varGrp ID="${id}"`);
  return start < 0 ? '' : xml.slice(start, xml.indexOf('</varGrp>', start));
}

const ddi = (rows: Record<string, unknown>[], settings = {}) =>
  buildDdiXml(rows, CHOICES, { ...OPTS, settings });

describe('standard DDI', () => {
  test('date and time are varFormat categories', () => {
    const xml = ddi([
      { type: 'date', name: 'd', label: 'D' },
      { type: 'time', name: 't', label: 'T' },
      { type: 'text', name: 's', label: 'S' },
    ]);
    expect(varXml(xml, 'd')).toContain('category="date"');
    expect(varXml(xml, 't')).toContain('category="time"');
    expect(varXml(xml, 's')).not.toContain('category=');
  });

  test('an integer has no decimals; a decimal says nothing', () => {
    const xml = ddi([
      { type: 'integer', name: 'i', label: 'I' },
      { type: 'decimal', name: 'x', label: 'X' },
    ]);
    expect(varXml(xml, 'i')).toContain('dcml="0"');
    expect(varXml(xml, 'x')).not.toContain('dcml');
  });

  test("a range's start and end are its valrng, and as authored a note", () => {
    const xml = ddi([
      {
        type: 'range',
        name: 'r',
        label: 'R',
        parameters: 'start=0 end=100 step=5',
      },
      { type: 'range', name: 'plain', label: 'P' },
    ]);
    const r = varXml(xml, 'r');
    expect(r).toContain('<range min="0" max="100"/>');
    // A bound equal to the default is told apart from none (#160).
    expect(r).toContain(
      '<notes type="cdl:parameters">start=0 end=100 step=5</notes>',
    );
    // The registry's defaults, as pyxform's.
    expect(varXml(xml, 'plain')).toContain('<range min="1" max="10"/>');
    expect(varXml(xml, 'plain')).not.toContain('cdl:parameters');
  });

  test('seqNo is the position among the data questions', () => {
    const xml = ddi([
      { type: 'note', name: 'n', label: 'Intro' },
      { type: 'text', name: 'a', label: 'A' },
      { type: 'select_multiple yn', name: 'm', label: 'M' },
      { type: 'text', name: 'b', label: 'B' },
    ]);
    expect(varXml(xml, 'a')).toContain('seqNo="1"');
    expect(varXml(xml, 'm_yes')).toContain('seqNo="2"');
    expect(varXml(xml, 'm_no')).toContain('seqNo="2"');
    expect(varXml(xml, 'b')).toContain('seqNo="3"');
  });

  test('backward names the questions the condition refers to', () => {
    const xml = ddi([
      { type: 'select_multiple yn', name: 'm', label: 'M' },
      { type: 'integer', name: 'k', label: 'K' },
      {
        type: 'text',
        name: 't',
        label: 'T',
        relevant: "selected(${m}, 'yes') and ${k} > 1 and ${k} < 9",
        hint: 'H',
        guidance_hint: 'G',
      },
    ]);
    const t = varXml(xml, 't');
    expect(t).toContain('<backward qstn="VG_m V_k"/>');
    // XSD order in qstn.
    expect(t.indexOf('<postQTxt>')).toBeLessThan(t.indexOf('<backward'));
    expect(t.indexOf('<backward')).toBeLessThan(t.indexOf('<ivuInstr>'));
  });

  test("a select_multiple's hints go with each option", () => {
    const xml = ddi([
      {
        type: 'select_multiple yn',
        name: 'm',
        label: 'M',
        hint: 'All that apply',
        guidance_hint: 'Read out',
      },
    ]);
    const v = varXml(xml, 'm_yes');
    expect(v).toContain('<preQTxt>M</preQTxt>');
    expect(v).toContain('<postQTxt>All that apply</postQTxt>');
    expect(v).toContain('<ivuInstr>Read out</ivuInstr>');
  });
});

describe('cdl: notes', () => {
  test('default, appearance and parameters on a question', () => {
    const xml = ddi([
      {
        type: 'select_one yn',
        name: 'q',
        label: 'Q',
        default: 'no',
        appearance: 'Minimal',
        parameters: 'randomize=true; guidance_hint=Only once',
      },
    ]);
    const v = varXml(xml, 'q');
    expect(v).toContain('<notes type="cdl:default">no</notes>');
    expect(v).toContain('<notes type="cdl:appearance">minimal</notes>');
    // The cell as authored (#160); its guidance_hint is the ivuInstr too.
    expect(v).toContain(
      '<notes type="cdl:parameters">randomize=true; guidance_hint=Only once</notes>',
    );
    expect(v).toContain('<ivuInstr>Only once</ivuInstr>');
  });

  test("a select_multiple's on its varGrp, with its exclusive choices", () => {
    const xml = ddi([
      {
        type: 'select_multiple yn',
        name: 'm',
        label: 'M',
        appearance: 'minimal',
      },
    ]);
    const grp = varGrp(xml, 'VG_m');
    expect(grp).toContain('<notes type="cdl:appearance">minimal</notes>');
    expect(grp).toContain('<notes type="cdl:exclusive">none</notes>');
    expect(varXml(xml, 'm_yes')).not.toContain('<notes');
  });

  test("a group's hint per language and its appearance", () => {
    const xml = buildDdiXml(
      [
        {
          type: 'begin_group',
          name: 'g',
          'label::Deutsch (de)': 'G',
          'label::English (en)': 'G',
          'hint::Deutsch (de)': 'Hinweis',
          'hint::English (en)': 'Hint',
          appearance: 'field-list',
        },
        { type: 'text', name: 't', 'label::Deutsch (de)': 'T' },
        { type: 'end_group' },
        {
          type: 'begin_group',
          name: 'grid',
          'label::Deutsch (de)': 'Grid',
          appearance: 'table-list',
        },
        { type: 'select_one yn', name: 'a', 'label::Deutsch (de)': 'A' },
        { type: 'end_group' },
      ],
      CHOICES,
      { ...OPTS, settings: { default_language: 'Deutsch (de)' } },
    );
    const g = varGrp(xml, 'VG_g');
    expect(g).toContain('<notes type="cdl:hint">Hinweis</notes>');
    expect(g).toContain('<notes type="cdl:hint" xml:lang="en">Hint</notes>');
    expect(g).toContain('<notes type="cdl:appearance">field-list</notes>');
    // A grid's table-list is its type.
    expect(varGrp(xml, 'VG_grid')).not.toContain('cdl:appearance');
  });

  test('style is a cdl:setting', () => {
    const xml = ddi([{ type: 'text', name: 't', label: 'T' }], {
      style: 'pages',
    });
    expect(xml).toContain(
      '<notes type="cdl:setting" subject="style">pages</notes>',
    );
  });
});

describe('convention:ddiFields', () => {
  const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../..',
  );
  const source = fs.readFileSync(
    path.join(ROOT, 'src/instrument/types.ts'),
    'utf-8',
  );

  /** `Interface.field` for each field of the model's interfaces. */
  function modelFields(): string[] {
    const out: string[] = [];
    const re = /interface (\w+)(?: extends \w+)? \{([\s\S]*?)\n\}/g;
    for (const [, name, body] of source.matchAll(re)) {
      for (const [, field] of body.matchAll(/^ {2}(\w+)\??:/gm)) {
        out.push(`${name}.${field}`);
      }
    }
    return out;
  }

  test('every Instrument field has a DDI home, a cdl: note or a documented loss', () => {
    const mapped = Object.keys(conventions.conventions.ddiFields.fields);
    const fields = modelFields();
    expect(fields.length).toBeGreaterThan(20);
    expect(fields.filter((f) => !mapped.includes(f))).toEqual([]);
    expect(mapped.filter((f) => !fields.includes(f))).toEqual([]);
  });
});
