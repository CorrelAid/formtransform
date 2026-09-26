/**
 * The built CLI (`dist/cli.js`): `xlsform2lstsv`, `lstsv2xlsform`, the
 * dispatcher and the argument/input error paths (#91). `xlsform2ddi`,
 * `lstsv2ddi --data` and `validate` exit codes are in cli2ddi.test.ts.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const CLI = join(ROOT, 'dist/cli.js');
const SURVEYS = join(ROOT, 'tests/fixtures/surveys');
const ENTITIES = join(ROOT, 'registry/entities');

let dir: string;

function cli(...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf-8',
  });
}

type Sheets = Record<string, Record<string, unknown>[]>;

/** Write sheets to `<dir>/<name>.xlsx` and return the path. */
function writeXlsx(name: string, sheets: Sheets): string {
  const wb = XLSX.utils.book_new();
  for (const [sheet, rows] of Object.entries(sheets)) {
    if (rows.length === 0) continue;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
  }
  const path = join(dir, `${name}.xlsx`);
  XLSX.writeFile(wb, path);
  return path;
}

/** A survey fixture's xlsform.json as an xlsx in the temp dir. */
function fixtureXlsx(name: string): string {
  const j = JSON.parse(
    readFileSync(join(SURVEYS, name, 'xlsform.json'), 'utf-8'),
  ) as { survey: []; choices?: []; settings?: [] };
  return writeXlsx(name, {
    survey: j.survey,
    choices: j.choices ?? [],
    settings: j.settings ?? [],
  });
}

const SIMPLE: Sheets = {
  survey: [
    { type: 'select_one yn', name: 'q1', label: '**Bold** question?' },
    { type: 'text', name: 'q2', label: 'Why?' },
  ],
  choices: [
    { list_name: 'yn', name: 'y', label: 'Yes' },
    { list_name: 'yn', name: 'n', label: 'No' },
  ],
};

const rowsOf = (tsv: string) => {
  const [header, ...lines] = tsv.trimEnd().split('\n');
  const cols = header.split('\t');
  return lines.map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
};
const sRow = (tsv: string, name: string) =>
  rowsOf(tsv).find((r) => r.class === 'S' && r.name === name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ft-cli-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('dispatcher', () => {
  test('no command prints help and exits 1', () => {
    const r = cli();
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/xlsform2lstsv/);
  });

  test('--help exits 0', () => {
    const r = cli('--help');
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/lstsv2xlsform/);
  });

  test('an unknown command exits 1 and names it', () => {
    const r = cli('frobnicate');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown command: frobnicate');
  });
});

describe('xlsform2lstsv', () => {
  // basic_survey's names have underscores, which the blessed TSV sanitizes.
  test('stdout matches the blessed TSV', () => {
    const r = cli(
      'xlsform2lstsv',
      fixtureXlsx('basic_survey'),
      '--skip-validation',
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(
      readFileSync(join(SURVEYS, 'basic_survey', 'tsv.tsv'), 'utf-8'),
    );
  });

  test('-o writes the file and says so on stderr', () => {
    const out = join(dir, 'out.tsv');
    const r = cli(
      'xlsform2lstsv',
      fixtureXlsx('basic_survey'),
      '--skip-validation',
      '-o',
      out,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(`Wrote ${out}`);
    expect(readFileSync(out, 'utf-8')).toBe(
      readFileSync(join(SURVEYS, 'basic_survey', 'tsv.tsv'), 'utf-8'),
    );
  });

  test('names outside the subset fail unless --skip-validation', () => {
    const form = join(dir, 'testA.xlsx');
    copyFileSync(join(SURVEYS, 'testA', 'xlsform.xlsx'), form);
    const strict = cli('xlsform2lstsv', form);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toMatch(/outside the XLSForm subset for LimeSurvey/);
    const loose = cli('xlsform2lstsv', form, '--skip-validation');
    expect(loose.status, loose.stderr).toBe(0);
    expect(loose.stdout).toBe(
      readFileSync(join(SURVEYS, 'testA', 'tsv.tsv'), 'utf-8'),
    );
  });

  test('--title, --language and --group-name set the defaults', () => {
    const form = writeXlsx('simple', SIMPLE);
    const r = cli(
      'xlsform2lstsv',
      form,
      '--title',
      'CLI Title',
      '--language',
      'de',
      '--group-name',
      'Fragen',
    );
    expect(r.status, r.stderr).toBe(0);
    const rows = rowsOf(r.stdout);
    expect(rows.find((x) => x.name === 'surveyls_title')?.text).toBe(
      'CLI Title',
    );
    expect(rows.find((x) => x.class === 'G')?.name).toBe('Fragen');
  });

  test('--no-markdown keeps the label as written', () => {
    const form = writeXlsx('simple', SIMPLE);
    const md = rowsOf(cli('xlsform2lstsv', form).stdout);
    const raw = rowsOf(cli('xlsform2lstsv', form, '--no-markdown').stdout);
    expect(md.find((x) => x.name === 'q1')?.text).toContain('<strong>Bold');
    expect(raw.find((x) => x.name === 'q1')?.text).toBe('**Bold** question?');
  });

  test('--show-no-answer drops the shownoanswer=N row', () => {
    const form = writeXlsx('simple', SIMPLE);
    expect(sRow(cli('xlsform2lstsv', form).stdout, 'shownoanswer')?.text).toBe(
      'N',
    );
    const shown = cli('xlsform2lstsv', form, '--show-no-answer').stdout;
    expect(sRow(shown, 'shownoanswer')).toBeUndefined();
  });

  test('--no-welcome-note keeps a `welcome` note as a question', () => {
    const form = writeXlsx('welcome', {
      survey: [
        { type: 'note', name: 'welcome', label: 'Hello' },
        { type: 'text', name: 'q', label: 'Q?' },
      ],
      choices: SIMPLE.choices,
    });
    const folded = rowsOf(cli('xlsform2lstsv', form).stdout);
    expect(folded.find((x) => x.name === 'welcome')).toBeUndefined();
    const kept = rowsOf(cli('xlsform2lstsv', form, '--no-welcome-note').stdout);
    expect(
      kept.find((x) => x.class === 'Q' && x.name === 'welcome'),
    ).toBeDefined();
  });

  test('--no-other-pattern keeps the `_other` companion question', () => {
    const src = join(ENTITIES, 'select_one_other', 'fixtures', 'xlsform.json');
    const j = JSON.parse(readFileSync(src, 'utf-8')) as Sheets;
    const form = writeXlsx('other', j);
    const folded = rowsOf(cli('xlsform2lstsv', form).stdout);
    expect(folded.find((x) => x.name === 'aufmerksamother')).toBeUndefined();
    const kept = rowsOf(
      cli('xlsform2lstsv', form, '--no-other-pattern').stdout,
    );
    expect(kept.find((x) => x.name === 'aufmerksamother')).toBeDefined();
  });

  test('reads a select_*_from_file CSV beside the form', () => {
    const form = writeXlsx('fromfile', {
      survey: [
        {
          type: 'select_one_from_file farben.csv',
          name: 'farbe',
          label: 'Farbe?',
        },
      ],
      choices: SIMPLE.choices,
    });
    writeFileSync(join(dir, 'farben.csv'), 'name,label\nrot,Rot\nblau,Blau\n');
    const r = cli('xlsform2lstsv', form);
    expect(r.status, r.stderr).toBe(0);
    const answers = rowsOf(r.stdout).filter((x) => x.class === 'A');
    expect(answers.map((a) => a.name)).toEqual(['rot', 'blau']);
  });
});

describe('lstsv2xlsform', () => {
  const tsv = join(ENTITIES, 'select_one', 'tsv.tsv');
  const authored = () =>
    JSON.parse(
      readFileSync(
        join(ENTITIES, 'select_one', 'fixtures', 'xlsform.json'),
        'utf-8',
      ),
    ) as { survey: { name: string; type: string }[] };

  test('writes the sheets as JSON', () => {
    const r = cli('lstsv2xlsform', tsv);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      survey: { name: string }[];
      choices: unknown[];
      settings: unknown[];
    };
    expect(out.survey.map((s) => s.name)).toEqual(
      authored().survey.map((s) => s.name),
    );
    expect(out.choices.length).toBeGreaterThan(0);
  });

  test('a TSV outside the subset fails unless --skip-validation', () => {
    const bad = join(dir, 'ranking.tsv');
    writeFileSync(
      bad,
      [
        'class\ttype/scale\tname\trelevance\ttext\thelp\tlanguage\tvalidation\tem_validation_q\tmandatory\tother\tdefault\tsame_default',
        'S\t\tlanguage\t1\ten\t\ten\t\t\t\t\t\t',
        'G\t\tG1\t1\t\t\ten\t\t\t\t\t\t',
        'Q\tR\trank\t1\tRank these\t\ten\t\t\t\t\t\t',
        '',
      ].join('\n'),
    );
    const strict = cli('lstsv2xlsform', bad);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toMatch(
      /conversion failed: .*outside the transformable subset/,
    );
    expect(cli('lstsv2xlsform', bad, '--skip-validation').status).toBe(0);
  });
});

describe('validate', () => {
  test('prints OK on success', () => {
    const r = cli('validate', writeXlsx('simple', SIMPLE));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/OK — within the XLSForm subset \(lstsv\)/);
  });

  test('--target must be lstsv or ddi', () => {
    const r = cli('validate', writeXlsx('simple', SIMPLE), '--target', 'kobo');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--target must be "lstsv" or "ddi", got "kobo"');
  });
});

describe('ddi flags', () => {
  test('--title and --prod-date reach xlsform2ddi and lstsv2ddi', () => {
    const form = writeXlsx('simple', SIMPLE);
    const flags = ['--title', 'Mein Titel', '--prod-date', '2001-02-03'];
    const fromXls = cli('xlsform2ddi', form, ...flags);
    const fromLs = cli(
      'lstsv2ddi',
      join(ENTITIES, 'select_one', 'tsv.tsv'),
      ...flags,
    );
    for (const r of [fromXls, fromLs]) {
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('<titl>Mein Titel</titl>');
      expect(r.stdout).toContain(
        '<prodDate date="2001-02-03">2001-02-03</prodDate>',
      );
    }
  });
});

describe('argument and input errors exit 1 with a message', () => {
  test.each([
    [
      'an unknown flag',
      ['xlsform2lstsv', 'x.xlsx', '--bogus'],
      /Unknown option '--bogus'/,
    ],
    ['a missing input', ['xlsform2lstsv'], /missing input \.xlsx path/],
    [
      'extra positionals',
      ['xlsform2lstsv', 'a.xlsx', 'b.xlsx'],
      /unexpected extra arguments: b\.xlsx/,
    ],
    [
      'an unreadable file',
      ['xlsform2lstsv', 'nope.xlsx'],
      /cannot read input file: nope\.xlsx/,
    ],
  ])('%s', (_, args, message) => {
    const r = cli(...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
  });

  test('a file that is not an xlsx', () => {
    writeFileSync(join(dir, 'bad.xlsx'), 'not a workbook');
    const r = cli('xlsform2lstsv', 'bad.xlsx');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /failed to parse XLSForm|conversion failed|outside the XLSForm subset/,
    );
  });

  test('an unreadable or unparsable --data file', () => {
    const form = writeXlsx('simple', SIMPLE);
    const missing = cli(
      'xlsform2ddi',
      form,
      '-o',
      'o.xml',
      '--data',
      'nope.csv',
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('cannot read data file: nope.csv');
    writeFileSync(join(dir, 'broken.json'), '{not json');
    const broken = cli(
      'xlsform2ddi',
      form,
      '-o',
      'o.xml',
      '--data',
      'broken.json',
    );
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain('failed to parse data file broken.json');
  });
});
