#!/usr/bin/env node
/**
 * Re-bless the frozen whole-survey snapshots
 * (tests/fixtures/surveys/<name>/{tsv.tsv,ddi.xml}) using the locally built
 * library (dist/index.js).
 *
 * The per-entity snapshots under registry/entities/ pin *one question type* at a
 * time. These pin whole hand-authored surveys — groups, multiple pages,
 * multilingual columns, relevance/constraint expressions, the settings
 * conversions — i.e. everything that only shows up when questions coexist.
 *
 * Manual gate, same contract as the other bless scripts: codegen never writes
 * these, so src/test/contract/surveySnapshots.test.ts stays non-tautological.
 *
 * Usage: npm run build && node scripts/bless-survey-snapshots.mjs
 *        (or: npm run bless -- surveys)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SURVEYS_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'surveys');

const entry = path.join(REPO_ROOT, 'dist', 'index.js');
if (!fs.existsSync(entry)) {
  console.error('dist/index.js missing — run `npm run build` first.');
  process.exit(1);
}
const { XLSFormToTSVConverter, XLSLoader, buildDdiXml } = await import(
  pathToFileURL(entry).href
);

// Fixed so a re-bless on another day is not a diff (the snapshot test scrubs it
// too, but keeping the file stable makes `git diff` mean something).
const PROD_DATE = '2020-01-01';

/** Load a survey fixture folder as {survey, choices, settings}. */
export function loadSurveyFixture(dir) {
  const json = path.join(dir, 'xlsform.json');
  if (fs.existsSync(json)) {
    const f = JSON.parse(fs.readFileSync(json, 'utf-8'));
    return {
      survey: f.survey ?? [],
      choices: f.choices ?? [],
      settings: f.settings ?? [],
    };
  }
  const xlsx = path.join(dir, 'xlsform.xlsx');
  if (!fs.existsSync(xlsx)) return null;
  const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
    fs.readFileSync(xlsx),
    // Hand-authored scenarios deliberately include names/codes the strict
    // subset rejects (long answer codes, underscores) — the point of these
    // fixtures is the *structure*, so the lenient path is used here and in the
    // snapshot test alike.
    { skipValidation: true },
  );
  return {
    survey: surveyData,
    choices: choicesData,
    settings: settingsData,
  };
}

const dirs = fs
  .readdirSync(SURVEYS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let written = 0;
const skipped = [];
for (const name of dirs) {
  const dir = path.join(SURVEYS_DIR, name);
  const fixture = loadSurveyFixture(dir);
  if (!fixture) {
    skipped.push([name, 'no xlsform.json / xlsform.xlsx']);
    continue;
  }

  try {
    const tsv = await new XLSFormToTSVConverter({
      skipValidation: true,
    }).convert(fixture.survey, fixture.choices, fixture.settings);
    fs.writeFileSync(path.join(dir, 'tsv.tsv'), tsv);

    const ddi = buildDdiXml(fixture.survey, fixture.choices, {
      assetName: name,
      prodDate: PROD_DATE,
    });
    fs.writeFileSync(path.join(dir, 'ddi.xml'), ddi);

    console.log(`blessed ${name} → tsv.tsv + ddi.xml`);
    written++;
  } catch (e) {
    // testA carries unimplemented types on purpose; a fixture that cannot be
    // converted gets no snapshot rather than a half-written one.
    skipped.push([name, e.message]);
  }
}

for (const [name, why] of skipped) {
  console.log(`skipped ${name}: ${why}`);
}
console.log(
  `\n${written} survey snapshots written, ${skipped.length} skipped.`,
);
console.log('Review with: git diff tests/fixtures/surveys/');
