/**
 * The DDI round trip (#154): XLSForm → DDI → Instrument gives back the
 * XLSForm's Instrument, compared on the model (`canonicalInstrument.ts`), for
 * every whole-survey fixture and registry entity, and through the XLSForm
 * sheets `ddi2xlsform` writes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';
import { instrumentFromDdi } from '../../../src/instrument/fromDdi.js';
import { instrumentFromXlsform } from '../../../src/instrument/fromXlsform.js';
import { XLSLoader } from '../../../src/xlsform/loader.js';
import { ddiToXlsform } from '../../../src/pipelines/ddi2xlsform/index.js';
import { canonical } from './canonicalInstrument.js';

type Row = Record<string, unknown>;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

interface Case {
  name: string;
  survey: Row[];
  choices: Row[];
  settings: Row[];
}

function load(name: string, dir: string, json: string): Case | null {
  if (fs.existsSync(json)) {
    const f = JSON.parse(fs.readFileSync(json, 'utf-8')) as Record<
      string,
      Row[]
    >;
    return {
      name,
      survey: f.survey ?? [],
      choices: f.choices ?? [],
      settings: f.settings ?? [],
    };
  }
  const xlsx = path.join(dir, 'xlsform.xlsx');
  if (!fs.existsSync(xlsx)) return null;
  const data = XLSLoader.parseXLSData(fs.readFileSync(xlsx), {
    skipValidation: true,
  });
  return {
    name,
    survey: data.surveyData as unknown as Row[],
    choices: data.choicesData as unknown as Row[],
    settings: data.settingsData as unknown as Row[],
  };
}

function cases(): Case[] {
  const out: Case[] = [];
  const surveys = path.join(ROOT, 'tests/fixtures/surveys');
  for (const name of fs.readdirSync(surveys).sort()) {
    const dir = path.join(surveys, name);
    const c = load(name, dir, path.join(dir, 'xlsform.json'));
    if (c) out.push(c);
  }
  const entities = path.join(ROOT, 'registry/entities');
  for (const name of fs.readdirSync(entities).sort()) {
    const dir = path.join(entities, name);
    const c = load(
      `entity:${name}`,
      dir,
      path.join(dir, 'fixtures/xlsform.json'),
    );
    if (c) out.push(c);
  }
  return out;
}

const CASES = cases();

describe('XLSForm → DDI → Instrument', () => {
  test('there are fixtures', () => {
    expect(CASES.length).toBeGreaterThan(20);
  });

  test.each(CASES)('$name', (c) => {
    const xml = buildDdiXml(c.survey, c.choices, {
      prodDate: '2020-01-01',
      settings: c.settings[0] ?? {},
    });
    const back = canonical(instrumentFromDdi(xml));
    const original = canonical(
      instrumentFromXlsform(c.survey, c.choices, c.settings),
    );
    expect(back).toEqual(original);
  });
});

describe('XLSForm → DDI → XLSForm sheets', () => {
  test.each(CASES)('$name', (c) => {
    const xml = buildDdiXml(c.survey, c.choices, {
      prodDate: '2020-01-01',
      settings: c.settings[0] ?? {},
    });
    const sheets = ddiToXlsform(xml);
    const back = canonical(
      instrumentFromXlsform(sheets.survey, sheets.choices, sheets.settings),
    );
    expect(back).toEqual(
      canonical(instrumentFromXlsform(c.survey, c.choices, c.settings)),
    );
  });
});

describe('the comparison is not blind', () => {
  const c = CASES.find((x) => x.name === 'validation_relevance_survey')!;
  const xml = buildDdiXml(c.survey, c.choices, { prodDate: '2020-01-01' });
  const original = canonical(instrumentFromXlsform(c.survey, c.choices));

  test.each([
    ['a relevant', /<notes type="cdl:relevant"[^>]*>[^<]*<\/notes>/],
    ['a constraint', /<notes type="cdl:constraint"[^>]*>[^<]*<\/notes>/],
    ['a label', /<qstnLit>Age<\/qstnLit>/],
  ])('losing %s is a difference', (_what, re) => {
    expect(xml).toMatch(re);
    expect(canonical(instrumentFromDdi(xml.replace(re, '')))).not.toEqual(
      original,
    );
  });
});

describe('blessed ddi2xlsform.json', () => {
  const surveys = path.join(ROOT, 'tests/fixtures/surveys');
  const blessed = fs
    .readdirSync(surveys)
    .filter((n) => fs.existsSync(path.join(surveys, n, 'ddi2xlsform.json')));

  test('every whole-survey fixture has one', () => {
    expect(blessed.length).toBeGreaterThan(10);
  });

  test.each(blessed)('%s matches ddi2xlsform of its ddi.xml', (name) => {
    const dir = path.join(surveys, name);
    const xml = fs.readFileSync(path.join(dir, 'ddi.xml'), 'utf-8');
    expect(ddiToXlsform(xml, { onWarning: () => {} })).toEqual(
      JSON.parse(fs.readFileSync(path.join(dir, 'ddi2xlsform.json'), 'utf-8')),
    );
  });
});
