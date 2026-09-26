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
 *   reverse  tsv     → xlsform    every question's type, relevant, constraint and
 *                                 appearance match the source, except the pinned
 *                                 KNOWN_REVERSE_XLSFORM_DIFFS
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import { buildDdiXml } from '../../../src/pipelines/xlsform2ddi/index.js';
import { lstsvToDdiXml } from '../../../src/pipelines/lstsv2ddi/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { XLSLoader } from '../../../src/xlsform/loader.js';
import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { METADATA_ROW_TYPES } from '../../../src/conventions/metadata.js';
import { otherCompanionBase } from '../../../src/conventions/other.js';
import { FieldSanitizer } from '../../../src/xlsform/sanitize.js';
import { normalizeName } from '../../../src/xlsform/identifiers.js';

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
  appearances_survey:
    'a label/list-nolabel matrix is a LimeSurvey array, so the reverse DDI makes its rows a ' +
    'grid (emitted first); the forward DDI treats only table-list as a grid and keeps them standalone',
  multilingual_survey:
    'the TSV carries one row set per language; the reverse keeps the base language only',
  complex_survey:
    'LimeSurvey names cap at 20 chars, so `favoritecolors`+`yellow` arrives back as `favoritecolorsyello`',
  testB:
    'two causes at once: 20-char name truncation ' +
    '(`descriptivestatistics` → `descriptivestatistic`), 5-char answer-code truncation feeding ' +
    'multipleResp variable names (`projectidprojectalpha` → `projectidproje`), plus the ' +
    'metadata variables (`start`, `end`) the TSV never carries',
  testA:
    '5-char answer-code truncation feeding multipleResp variable names ' +
    '(`bereichemetall` → `bereichemetal`)',
  all_types_survey:
    'metadata/hidden rows (start, end, today, deviceid, username, audit, hidden1) are ' +
    'variables in the forward DDI but are skipped by the TSV, so the reverse cannot know them',
};

/**
 * What tsv → xlsform measurably does not give back, per survey (see
 * reverseXlsformDiffs). Exact: a fix or a new loss both fail the suite, so the
 * list only shrinks deliberately.
 */
const KNOWN_REVERSE_XLSFORM_DIFFS: Record<
  string,
  { why: string; diffs: string[] }
> = {
  appearances_survey: {
    why: 'a matrix (label header + list-nolabel rows) comes back as the canonical table-list grid; `likert` has no LimeSurvey equivalent',
    diffs: [
      'zufrieden.appearance: likert -> ∅',
      'kopf.type: select_one -> begin_group',
      'kopf.appearance: label -> table-list',
      'bus.appearance: list-nolabel -> ∅',
      'bahn.appearance: list-nolabel -> ∅',
    ],
  },
  all_types_survey: {
    why: 'a matrix (label header + list-nolabel rows) comes back as the canonical table-list grid, so the header row and the per-row appearance are gone; `likert` has no LimeSurvey equivalent',
    diffs: [
      'q_likert.appearance: likert -> ∅',
      'matrix_header: missing',
      'skill_python.appearance: list-nolabel -> ∅',
      'skill_js.appearance: list-nolabel -> ∅',
      'skill_sql.appearance: list-nolabel -> ∅',
    ],
  },
  complex_xpath_survey: {
    why: 'true()/false() come back as 1/0 (the forward writes EM 1/0)',
    diffs: [
      'age_category.relevant: if(${age} > 18, true(), false()) -> if(${age} > 18, 1, 0)',
    ],
  },
  testA: {
    why: "`likert` has no LimeSurvey equivalent; answer codes are cut to LimeSurvey's 5 characters (`andere` \u2192 `ander`)",
    diffs: [
      'wohlfuehlen.appearance: likert -> ∅',
      'freundschaften.appearance: likert -> ∅',
      'eigene_ideen.appearance: likert -> ∅',
      'problemloesung.appearance: likert -> ∅',
      'skills_gelernt.appearance: likert -> ∅',
      'beruf_pre.appearance: likert -> ∅',
      'beruf_post.appearance: likert -> ∅',
      'nps_score.appearance: likert -> ∅',
      "geschlecht_andere.relevant: ${geschlecht} = 'andere' -> ${geschlecht} = 'ander'",
    ],
  },
  testB: {
    why: 'answer codes are cut to 5 characters and deduplicated (`project-beta` \u2192 `proj1`); a matrix comes back as the canonical table-list grid (header row and per-row appearance gone)',
    diffs: [
      "project_role_project-alpha.relevant: selected(${projectid}, 'project-alpha') -> selected(${projectid}, 'proje')",
      "project_role_project-beta.relevant: selected(${projectid}, 'project-beta') -> selected(${projectid}, 'proj1')",
      "project_role_project-gamma.relevant: selected(${projectid}, 'project-gamma') -> selected(${projectid}, 'proj2')",
      'rating_technologies_tools_header: missing',
      "sosci_survey.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'sosci_survey.appearance: list-nolabel -> ∅',
      "python.relevant: selected(${projectroleprojectal}, 'role-data-analysis') -> selected(${projectroleprojectal}, 'roled')",
      'python.appearance: list-nolabel -> ∅',
      "rstats.relevant: selected(${projectroleprojectal}, 'role-data-analysis') -> selected(${projectroleprojectal}, 'roled')",
      'rstats.appearance: list-nolabel -> ∅',
      "powerbi.relevant: selected(${projectroleprojectbe}, 'role-visualization') -> selected(${projectroleprojectbe}, 'rolev')",
      'powerbi.appearance: list-nolabel -> ∅',
      "excel.relevant: selected(${projectroleprojectbe}, 'role-visualization') -> selected(${projectroleprojectbe}, 'rolev')",
      'excel.appearance: list-nolabel -> ∅',
      "sql.relevant: selected(${projectroleprojectbe}, 'role-data-engineering') -> selected(${projectroleprojectbe}, 'roled')",
      'sql.appearance: list-nolabel -> ∅',
      "git.relevant: selected(${projectroleprojectbe}, 'role-data-engineering') -> selected(${projectroleprojectbe}, 'roled')",
      'git.appearance: list-nolabel -> ∅',
      "jupyter.relevant: selected(${projectroleprojectga}, 'role-machine-learning') -> selected(${projectroleprojectga}, 'rolem')",
      'jupyter.appearance: list-nolabel -> ∅',
      "tensorflow.relevant: selected(${projectroleprojectga}, 'role-machine-learning') -> selected(${projectroleprojectga}, 'rolem')",
      'tensorflow.appearance: list-nolabel -> ∅',
      'rating_techniques_header.type: select_one -> begin_group',
      'rating_techniques_header.appearance: label -> table-list',
      "survey_design.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'survey_design.appearance: list-nolabel -> ∅',
      "indicator_development.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'indicator_development.appearance: list-nolabel -> ∅',
      "data_collection.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'data_collection.appearance: list-nolabel -> ∅',
      "data_cleaning.relevant: selected(${projectroleprojectal}, 'role-data-analysis') -> selected(${projectroleprojectal}, 'roled')",
      'data_cleaning.appearance: list-nolabel -> ∅',
      "descriptive_statistics.relevant: selected(${projectroleprojectal}, 'role-data-analysis') -> selected(${projectroleprojectal}, 'roled')",
      'descriptive_statistics.appearance: list-nolabel -> ∅',
      "data_visualization.relevant: selected(${projectroleprojectbe}, 'role-visualization') -> selected(${projectroleprojectbe}, 'rolev')",
      'data_visualization.appearance: list-nolabel -> ∅',
      "data_engineering.relevant: selected(${projectroleprojectbe}, 'role-data-engineering') -> selected(${projectroleprojectbe}, 'roled')",
      'data_engineering.appearance: list-nolabel -> ∅',
      "automation.relevant: selected(${projectroleprojectbe}, 'role-data-engineering') -> selected(${projectroleprojectbe}, 'roled')",
      'automation.appearance: list-nolabel -> ∅',
      "projectplanning.relevant: selected(${projectroleprojectga}, 'role-project-management') -> selected(${projectroleprojectga}, 'rolep')",
      'projectplanning.appearance: list-nolabel -> ∅',
      "mlmodeling.relevant: selected(${projectroleprojectga}, 'role-machine-learning') -> selected(${projectroleprojectga}, 'rolem')",
      'mlmodeling.appearance: list-nolabel -> ∅',
      'rating_topics_header.type: select_one -> begin_group',
      'rating_topics_header.appearance: label -> table-list',
      "wirkungsmessung.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'wirkungsmessung.appearance: list-nolabel -> ∅',
      "research_design.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'research_design.appearance: list-nolabel -> ∅',
      "survey_research.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'survey_research.appearance: list-nolabel -> ∅',
      "data_protection.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'data_protection.appearance: list-nolabel -> ∅',
      "resilience_mental_health.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'resilience_mental_health.appearance: list-nolabel -> ∅',
      "education_research.relevant: selected(${projectroleprojectal}, 'role-survey-design') -> selected(${projectroleprojectal}, 'roles')",
      'education_research.appearance: list-nolabel -> ∅',
      "past_applications_details.relevant: ${pastapplications} = 'not_successful' -> ${pastapplications} = 'notsu'",
      "gender_self_identification.relevant: ${gender} = 'self_identification' -> ${gender} = 'selfi'",
    ],
  },
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
    if (!fs.existsSync(path.join(dir, 'tsv.tsv'))) continue;
    const fixture = loadFixture(dir);
    if (!fixture) continue;
    cases.push({ name, dir, ...fixture });
  }
  return cases;
}

const CASES = discoverCases();

type Row = Record<string, unknown>;

/** Types the reverse spells differently by design: LimeSurvey has one numeric
 * type (N → decimal) and `string` is XLSForm's alias of `text`. */
const REVERSE_TYPE = (t: string): string =>
  ({ integer: 'decimal', int: 'decimal', string: 'text' })[t] ?? t;

/**
 * Per question, what tsv → xlsform does not give back: `<name>.<field>: a -> b`,
 * or `<name>: missing`. Names are mapped the way the forward TSV writes them
 * (sanitized, unique, ≤ 20 chars); `${ref}`s inside expressions likewise.
 * Groups, metadata rows and `end_*` rows are not questions and are skipped.
 */
function reverseXlsformDiffs(c: SurveyCase, back: Row[]): string[] {
  const sanitizer = new FieldSanitizer(() => {});
  const lsName = new Map<string, string>();
  for (const r of c.survey) {
    const t = String(r.type ?? '').trim();
    const n = String(r.name ?? '').trim();
    if (!n || t.startsWith('end')) continue;
    try {
      lsName.set(n, sanitizer.sanitizeNameUnique(n));
    } catch {
      /* a name with nothing usable: reported as missing below */
    }
  }
  const mapName = (n: string) => {
    const base = otherCompanionBase(n);
    if (base && lsName.has(base)) return `${lsName.get(base)}_other`;
    return lsName.get(n) ?? normalizeName(n);
  };
  const expr = (v: unknown) =>
    String(v ?? '')
      .replace(/\$\{\s*([^}\s]+)\s*\}/g, (_, n: string) => `\${${mapName(n)}}`)
      .replace(/\s+/g, ' ')
      .trim();

  const byName = new Map(back.map((r) => [String(r.name), r]));
  const diffs: string[] = [];
  for (const r of c.survey) {
    const t = String(r.type ?? '').trim();
    const base = t.split(/\s+/)[0];
    if (!t || /^(begin|end)[_ ]/.test(t) || METADATA_ROW_TYPES.includes(base)) {
      continue;
    }
    const name = String(r.name ?? '');
    const b = byName.get(mapName(name));
    if (!b) {
      diffs.push(`${name}: missing`);
      continue;
    }
    const backType = String(b.type ?? '').split(/\s+/)[0];
    if (REVERSE_TYPE(base) !== backType) {
      diffs.push(`${name}.type: ${base} -> ${backType}`);
    }
    for (const f of ['relevant', 'constraint', 'appearance']) {
      const [a, z] = [expr(r[f]), expr(b[f])];
      if (a !== z) diffs.push(`${name}.${f}: ${a || '∅'} -> ${z || '∅'}`);
    }
  }
  return diffs;
}

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
        // The settings sheet feeds IDNo, verStmt and codeBook/@xml:lang (#102).
        settings: c.settings[0],
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

    test('tsv → xlsform gives back each question, except the pinned losses', () => {
      const tsv = fs.readFileSync(path.join(c.dir, 'tsv.tsv'), 'utf-8');
      const back = lstsvToXlsform(tsv, { skipValidation: true });
      expect(reverseXlsformDiffs(c, back.survey as Row[])).toEqual(
        KNOWN_REVERSE_XLSFORM_DIFFS[name]?.diffs ?? [],
      );
    });
  },
);
