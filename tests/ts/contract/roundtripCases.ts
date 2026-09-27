/**
 * The forms the round-trip tests run on (#154, #160): every whole-survey
 * fixture and every registry entity's example, as XLSForm sheets, with its
 * committed LimeSurvey TSV where there is one.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { XLSLoader } from '../../../src/xlsform/loader.js';

type Row = Record<string, unknown>;

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export interface Case {
  name: string;
  survey: Row[];
  choices: Row[];
  settings: Row[];
  /** The committed `tsv.tsv`, if any. */
  tsv?: string;
}

function readTsv(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
}

function load(
  name: string,
  dir: string,
  json: string,
  tsv: string,
): Case | null {
  const committed = readTsv(tsv);
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
      tsv: committed,
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
    tsv: committed,
  };
}

/** Every fixture form: surveys first, then `entity:<slug>`. */
export function cases(): Case[] {
  const out: Case[] = [];
  const surveys = path.join(ROOT, 'tests/fixtures/surveys');
  for (const name of fs.readdirSync(surveys).sort()) {
    const dir = path.join(surveys, name);
    const c = load(
      name,
      dir,
      path.join(dir, 'xlsform.json'),
      path.join(dir, 'tsv.tsv'),
    );
    if (c) out.push(c);
  }
  const entities = path.join(ROOT, 'registry/entities');
  for (const name of fs.readdirSync(entities).sort()) {
    const dir = path.join(entities, name);
    const c = load(
      `entity:${name}`,
      dir,
      path.join(dir, 'fixtures/xlsform.json'),
      path.join(dir, 'tsv.tsv'),
    );
    if (c) out.push(c);
  }
  return out;
}
