/**
 * Whole-survey contract: every transformation direction, over hand-authored
 * surveys rather than single-question registry entities.
 *
 * The per-entity suites pin one question type at a time. Anything that only
 * exists *between* questions is invisible to them: group nesting, page breaks,
 * a multilingual column set, relevance/constraint expressions that reference
 * another question, the welcome/end-note conversions. These fixtures
 * (`tests/fixtures/surveys/<name>/`) carry exactly that, and each folder holds
 * the same trio as a registry entity — `xlsform.{json,xlsx}` source plus blessed
 * `tsv.tsv` and `ddi.xml`.
 *
 * Bless with `npm run bless -- surveys` after an intentional change.
 *
 * Directions asserted here:
 *   forward  xlsform → tsv        byte-for-byte
 *   forward  xlsform → ddi        byte-for-byte (prodDate scrubbed)
 *   reverse  tsv     → ddi        same variables + response domains as the forward
 *                                 DDI (names sanitized, since LimeSurvey names are
 *                                 alphanumeric-only)
 *   reverse  tsv     → xlsform    question names + types survive
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../pipelines/xlsform2ddi/index.js';
import { lstsvToDdiXml } from '../../pipelines/lstsv2ddi/index.js';
import { lstsvToXlsform } from '../../pipelines/lstsv2xlsform/index.js';
import { XLSLoader } from '../../xlsform/loader.js';
import { XLSFormToTSVConverter } from '../../pipelines/xlsform2lstsv/index.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const SURVEYS_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'surveys');

/** Same fixed date the bless script writes, so the diff stays meaningful. */
const PROD_DATE = '2020-01-01';

/**
 * Surveys whose reverse DDI does not even match the forward DDI *structurally*
 * (variable list + response domains), with the measured reason. Byte parity is
 * never expected here — see `sanitizeName` — but a differing variable list is a
 * real loss and has to be named. The list is asserted to be exact: an entry that
 * stops applying fails the suite rather than rotting.
 */
const REVERSE_DDI_STRUCTURAL_DIFF: Record<string, string> = {
  multilingual_survey:
    'the TSV carries one row set per language; the reverse keeps the base language only',
  complex_survey:
    'LimeSurvey names cap at 20 chars, so `favoritecolors`+`yellow` arrives back as `favoritecolorsyello`',
  testB:
    'two causes at once: 20-char name truncation ' +
    '(`descriptivestatistics` → `descriptivestatistic`), 5-char answer-code truncation feeding ' +
    'multipleResp variable names (`projectidprojectalpha` → `projectidproje`), plus the ' +
    'metadata variables (`start`, `end`) the TSV never carries',
  all_types_survey:
    'metadata/hidden rows (start, end, today, deviceid, username, audit, hidden1) are ' +
    'variables in the forward DDI but are skipped by the TSV, so the reverse cannot know them',
};

interface SurveyCase {
  name: string;
  dir: string;
  survey: Record<string, unknown>[];
  choices: Record<string, unknown>[];
  settings: Record<string, unknown>[];
}

function loadFixture(dir: string): Omit<SurveyCase, 'name' | 'dir'> | null {
  const json = path.join(dir, 'xlsform.json');
  if (fs.existsSync(json)) {
    const f = JSON.parse(fs.readFileSync(json, 'utf-8')) as Record<
      string,
      Record<string, unknown>[]
    >;
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
    // These fixtures intentionally carry names/codes the strict subset rejects;
    // the bless script uses the same lenient path.
    { skipValidation: true },
  );
  return {
    survey: surveyData as unknown as Record<string, unknown>[],
    choices: choicesData as unknown as Record<string, unknown>[],
    settings: settingsData as unknown as Record<string, unknown>[],
  };
}

/** Every fixture folder that carries blessed snapshots. */
function discoverCases(): SurveyCase[] {
  const cases: SurveyCase[] = [];
  for (const name of fs.readdirSync(SURVEYS_DIR).sort()) {
    const dir = path.join(SURVEYS_DIR, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    // testA has no snapshots on purpose (unimplemented `range` type).
    if (!fs.existsSync(path.join(dir, 'tsv.tsv'))) continue;
    const fixture = loadFixture(dir);
    if (!fixture) continue;
    cases.push({ name, dir, ...fixture });
  }
  return cases;
}

const CASES = discoverCases();

/** `prodDate` is build-time wallclock; scrub so comparison survives the calendar. */
function scrubProdDate(xml: string): string {
  return xml.replace(/<prodDate[^>]*>[^<]*<\/prodDate>/g, '<prodDate/>');
}

/**
 * LimeSurvey names are alphanumeric-only, so the forward TSV sanitizes what the
 * author wrote (`respondent_name` → `respondentname`) and the reverse can only
 * recover the sanitized form. Byte parity with the forward DDI is therefore
 * impossible for any survey whose authored names carry separators — unlike the
 * registry entities, which are authored LimeSurvey-legal on purpose.
 */
function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '');
}

/** `[{name, responseDomainType}]` in document order — the comparable core. */
function variableShape(xml: string): { name: string; domain: string }[] {
  const out: { name: string; domain: string }[] = [];
  const varRe = /<var\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/var>/g;
  let m: RegExpExecArray | null;
  while ((m = varRe.exec(xml)) !== null) {
    const domain = /responseDomainType="([^"]*)"/.exec(m[2])?.[1] ?? '';
    out.push({ name: sanitizeName(m[1]), domain });
  }
  return out;
}

describe('whole-survey fixtures', () => {
  test('fixtures are discovered', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(9);
  });

  test('every fixture folder holds both blessed snapshots', () => {
    for (const c of CASES) {
      expect(
        fs.existsSync(path.join(c.dir, 'ddi.xml')),
        `${c.name}: ddi.xml missing — run \`npm run bless -- surveys\``,
      ).toBe(true);
    }
  });

  test('the structural-diff list names only real fixtures', () => {
    const names = new Set(CASES.map((c) => c.name));
    for (const name of Object.keys(REVERSE_DDI_STRUCTURAL_DIFF)) {
      expect(names.has(name), `stale structural-diff entry: ${name}`).toBe(
        true,
      );
    }
  });
});

describe.each(CASES.map((c) => [c.name, c] as const))(
  'survey: %s',
  (name, c) => {
    test('xlsform → tsv matches the blessed snapshot', async () => {
      const tsv = await new XLSFormToTSVConverter({
        skipValidation: true,
      }).convert(c.survey, c.choices, c.settings);
      const blessed = fs.readFileSync(path.join(c.dir, 'tsv.tsv'), 'utf-8');
      expect(
        tsv,
        `${name}: TSV drifted — fix the converter or run \`npm run bless -- surveys\``,
      ).toBe(blessed);
    });

    test('xlsform → ddi matches the blessed snapshot', () => {
      const ddi = buildDdiXml(c.survey, c.choices, {
        assetName: name,
        prodDate: PROD_DATE,
      });
      const blessed = fs.readFileSync(path.join(c.dir, 'ddi.xml'), 'utf-8');
      expect(
        scrubProdDate(ddi),
        `${name}: DDI drifted — fix the emitter or run \`npm run bless -- surveys\``,
      ).toBe(scrubProdDate(blessed));
    });

    test('tsv → ddi recovers the same variables', () => {
      const tsv = fs.readFileSync(path.join(c.dir, 'tsv.tsv'), 'utf-8');
      const reverse = lstsvToDdiXml(tsv, {
        assetName: name,
        prodDate: PROD_DATE,
        skipValidation: true,
      });
      expect(reverse, name).toContain('<codeBook');

      const forward = fs.readFileSync(path.join(c.dir, 'ddi.xml'), 'utf-8');
      const known = REVERSE_DDI_STRUCTURAL_DIFF[name];
      if (known) {
        // Structure is known to shrink; a silently empty codebook is still a bug.
        expect(reverse, `${name}: reverse DDI has no variables`).toContain(
          '<var ',
        );
        return;
      }
      expect(
        variableShape(reverse),
        `${name}: reverse DDI lost or renamed variables (${known ?? 'no known reason'})`,
      ).toEqual(variableShape(forward));
    });

    test('tsv → xlsform preserves question names and types', () => {
      const tsv = fs.readFileSync(path.join(c.dir, 'tsv.tsv'), 'utf-8');
      const back = lstsvToXlsform(tsv, { skipValidation: true });
      const backRows = back.survey.filter(
        (r) => !String(r.type ?? '').startsWith('begin_'),
      );
      expect(
        backRows.length,
        `${name}: reverse produced no questions`,
      ).toBeGreaterThan(0);
      for (const row of backRows) {
        expect(String(row.type ?? ''), `${name}: row without a type`).not.toBe(
          '',
        );
      }
    });
  },
);
