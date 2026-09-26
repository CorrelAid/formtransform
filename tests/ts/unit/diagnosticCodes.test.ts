/**
 * Every diagnostic code, produced from a minimal input and asserted by `code`
 * (#108). Consumers branch on `code`, so renaming one must break a test, not
 * only a message regex.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as XLSX from 'xlsx';
import { describe, expect, test } from 'vitest';

import type { Diagnostic } from '../../../src/diagnostics.js';
import { xlsformToLstsv } from '../../../src/api.js';
import { lstsvToDataCsv } from '../../../src/pipelines/lstsv2ddi/index.js';
import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';
import { validateLstsvSubset } from '../../../src/lstsv/validate.js';
import { parseLstsv } from '../../../src/lstsv/parser.js';
import { FieldSanitizer } from '../../../src/xlsform/sanitize.js';
import { XLSLoader } from '../../../src/xlsform/loader.js';
import { XLSValidator } from '../../../src/xlsform/validate.js';

type Row = Record<string, unknown>;

const yn = [
  { list_name: 'yn', name: 'y', label: 'Ja' },
  { list_name: 'yn', name: 'n', label: 'Nein' },
];

const subsetCodes = (survey: Row[], choices: Row[] = yn) =>
  XLSValidator.validateSubset(survey, choices).map((d) => d.code);

function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

async function rejectedCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const TSV_HEADER =
  'class\ttype/scale\tname\trelevance\ttext\thelp\tlanguage\tvalidation\tem_validation_q\tmandatory\tother\tdefault\tsame_default';
const tsv = (...rows: string[]) =>
  [
    TSV_HEADER,
    'S\t\tlanguage\t1\ten\t\ten\t\t\t\t\t\t',
    'G\t\tG1\t1\t\t\ten\t\t\t\t\t\t',
    ...rows,
    '',
  ].join('\n');

describe('loader', () => {
  const surveyHeader = ['type', 'name', 'label'];
  const choicesHeader = ['list_name', 'name', 'label'];

  test('sheet-missing: no choices sheet', () => {
    const buf = workbook({ survey: [surveyHeader, ['text', 'q', 'Q?']] });
    expect(thrownCode(() => XLSLoader.parseXLSData(buf))).toBe('sheet-missing');
  });

  test('sheet-empty: a survey sheet with a header and no rows warns', () => {
    const warnings: Diagnostic[] = [];
    const buf = workbook({
      survey: [surveyHeader],
      choices: [choicesHeader, ['yn', 'y', 'Ja']],
    });
    XLSLoader.parseXLSData(buf, { onWarning: (w) => warnings.push(w) });
    expect(warnings.map((w) => w.code)).toContain('sheet-empty');
  });

  test('column-missing: a survey sheet without `name`', () => {
    const buf = workbook({
      survey: [
        ['type', 'label'],
        ['text', 'Q?'],
      ],
      choices: [choicesHeader, ['yn', 'y', 'Ja']],
    });
    expect(thrownCode(() => XLSLoader.parseXLSData(buf))).toBe(
      'column-missing',
    );
  });

  test('column-unexpected names the column (e.g. choice_filter)', () => {
    const warnings: Diagnostic[] = [];
    const buf = workbook({
      survey: [
        [...surveyHeader, 'choice_filter'],
        ['text', 'q', 'Q?', 'x'],
      ],
      choices: [choicesHeader, ['yn', 'y', 'Ja']],
    });
    XLSLoader.parseXLSData(buf, { onWarning: (w) => warnings.push(w) });
    const w = warnings.find((x) => x.code === 'column-unexpected');
    expect(w?.message).toContain('choice_filter');
  });

  test('language-invalid: a well-formed tag with an unknown language', () => {
    const warnings: Diagnostic[] = [];
    const buf = workbook({
      survey: [
        ['type', 'name', 'label::xx'],
        ['text', 'q', 'Q?'],
      ],
      choices: [choicesHeader, ['yn', 'y', 'Ja']],
    });
    XLSLoader.parseXLSData(buf, {
      skipValidation: true,
      onWarning: (w) => warnings.push(w),
    });
    expect(warnings.map((w) => w.code)).toContain('language-invalid');
  });
});

describe('validateSubset', () => {
  test.each<[string, Row[], Row[]?]>([
    ['name-too-long', [{ type: 'text', name: 'a'.repeat(21), label: 'Q?' }]],
    [
      'name-duplicate',
      [
        { type: 'text', name: 'q', label: 'Q?' },
        { type: 'text', name: 'q', label: 'Again?' },
      ],
    ],
    [
      'code-invalid',
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', name: 'a_b', label: 'A' }],
    ],
    [
      'code-too-long',
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', name: 'abcdef', label: 'A' }],
    ],
    [
      'code-duplicate',
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [
        { list_name: 'l', name: 'a', label: 'A' },
        { list_name: 'l', name: 'a', label: 'Also A' },
      ],
    ],
    [
      'code-missing',
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', label: 'No code' }],
    ],
    [
      'label-missing',
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', name: 'a' }],
    ],
    ['choice-list-missing', [{ type: 'select_one', name: 'q', label: 'Q?' }]],
    [
      'vocab-file-missing',
      [{ type: 'select_one_from_file', name: 'q', label: 'Q?' }],
    ],
    [
      'vocab-unregistered',
      [{ type: 'select_one_from_file nope.csv', name: 'q', label: 'Q?' }],
    ],
    [
      'appearance-invalid-for-type',
      [{ type: 'text', name: 'q', label: 'Q?', appearance: 'likert' }],
    ],
    [
      'exclusive-invalid',
      [{ type: 'select_multiple l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', name: 'a', label: 'A', exclusive: 'maybe' }],
    ],
    [
      'exclusive-no-effect',
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', name: 'a', label: 'A', exclusive: 'yes' }],
    ],
  ])('%s', (code, survey, choices) => {
    expect(subsetCodes(survey, choices)).toContain(code);
  });

  test("code-invalid names the code, 'a_b'", () => {
    const found = XLSValidator.validateSubset(
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', name: 'a_b', label: 'A' }],
    ).find((d) => d.code === 'code-invalid');
    expect(found?.message).toContain('a_b');
  });

  // The companion is checked as LimeSurvey's code, `<base>other`: the
  // underscore is exempt, the length is not.
  test('the _other companion counts as `<base>other` for the length limit', () => {
    const base = 'a'.repeat(15);
    const survey = [
      { type: 'select_one yn', name: base, label: 'Q?' },
      {
        type: 'text',
        name: `${base}_other`,
        label: 'Which?',
        relevant: `\${${base}} = 'other'`,
      },
    ];
    const tooLong = XLSValidator.validateSubset(survey, yn).filter(
      (d) => d.code === 'name-too-long',
    );
    expect(tooLong).toEqual([]);
    const longer = `${base}b`;
    const over = XLSValidator.validateSubset(
      [
        { type: 'select_one yn', name: longer, label: 'Q?' },
        { type: 'text', name: `${longer}_other`, label: 'Which?' },
      ],
      yn,
    ).map((d) => d.code);
    expect(over).toContain('name-too-long');
  });

  test('exclusive-invalid quotes the value', () => {
    const found = XLSValidator.validateSubset(
      [{ type: 'select_multiple l', name: 'q', label: 'Q?' }],
      [{ list_name: 'l', name: 'a', label: 'A', exclusive: 'maybe' }],
    ).find((d) => d.code === 'exclusive-invalid');
    expect(found?.message).toContain('"maybe"');
  });
});

describe('sanitizer', () => {
  test('name-collision: two names that sanitize alike; the suffix stays within 20', () => {
    const warnings: Diagnostic[] = [];
    const s = new FieldSanitizer((w) => warnings.push(w));
    const a = s.sanitizeNameUnique('a'.repeat(20));
    const b = s.sanitizeNameUnique(`${'a'.repeat(19)}_a`);
    expect(a).toBe('a'.repeat(20));
    expect(b).toHaveLength(20);
    expect(b).not.toBe(a);
    expect(warnings.map((w) => w.code)).toContain('name-collision');
  });

  test('name-truncated: a name over 20 characters warns', () => {
    const warnings: Diagnostic[] = [];
    new FieldSanitizer((w) => warnings.push(w)).sanitizeName('b'.repeat(25));
    expect(warnings.map((w) => w.code)).toContain('name-truncated');
  });

  test('code-empty-after-sanitize: nothing usable left', () => {
    expect(
      thrownCode(() => new FieldSanitizer().sanitizeAnswerCode('___')),
    ).toBe('code-empty-after-sanitize');
  });
});

describe('converter', () => {
  const warningsOf = async (survey: Row[], choices: Row[]) => {
    const warnings: Diagnostic[] = [];
    await xlsformToLstsv(
      { surveyData: survey as never, choicesData: choices as never },
      { skipValidation: true, onWarning: (w) => warnings.push(w) },
    );
    return warnings;
  };

  test('other-label-noncanonical: an "other" choice labelled otherwise', async () => {
    const warnings = await warningsOf(
      [
        { type: 'select_one l', name: 'q', label: 'Q?' },
        {
          type: 'text',
          name: 'q_other',
          label: 'Which?',
          relevant: "${q} = 'other'",
        },
      ],
      [
        { list_name: 'l', name: 'a', label: 'A' },
        { list_name: 'l', name: 'other', label: 'Something else' },
      ],
    );
    expect(warnings.map((w) => w.code)).toContain('other-label-noncanonical');
  });

  test('code-duplicate: two codes equal after truncation to 5', async () => {
    const warnings = await warningsOf(
      [{ type: 'select_one l', name: 'q', label: 'Q?' }],
      [
        { list_name: 'l', name: 'abcdef1', label: 'One' },
        { list_name: 'l', name: 'abcdef2', label: 'Two' },
      ],
    );
    expect(warnings.map((w) => w.code)).toContain('code-duplicate');
  });

  test('parameter-invalid: a non-numeric range bound', async () => {
    const code = await rejectedCode(
      xlsformToLstsv(
        {
          surveyData: [
            {
              type: 'range',
              name: 'r',
              label: 'R?',
              parameters: 'start=x end=10',
            },
          ] as never,
          choicesData: [],
        },
        { skipValidation: true },
      ),
    );
    expect(code).toBe('parameter-invalid');
  });
});

describe('LimeSurvey TSV (reverse)', () => {
  test('lstsv-outside-subset: a ranking question', () => {
    const rows = parseLstsv(tsv('Q\tR\trank\t1\tRank\t\ten\t\t\t\t\t\t'));
    expect(validateLstsvSubset(rows).map((d) => d.code)).toContain(
      'lstsv-outside-subset',
    );
    expect(
      thrownCode(() =>
        lstsvToXlsform(tsv('Q\tR\trank\t1\tRank\t\ten\t\t\t\t\t\t')),
      ),
    ).toBe('lstsv-outside-subset');
  });

  test('em-unsupported: a relevance the reverse parser cannot read', () => {
    const input = tsv(
      'Q\tS\ta\t1\tA?\t\ten\t\t\t\t\t\t',
      'Q\tS\tb\ta b\tB?\t\ten\t\t\t\t\t\t',
    );
    expect(thrownCode(() => lstsvToXlsform(input))).toBe('em-unsupported');
  });

  test('response-ambiguous: a subkey that prefixes two choice codes', () => {
    const input = tsv(
      'Q\tM\tq\t1\tQ?\t\ten\t\t\t\t\t\t',
      'SQ\t\tab\t\tAB\t\ten\t\t\t\t\t\t',
      'SQ\t\tabc\t\tABC\t\ten\t\t\t\t\t\t',
    );
    expect(thrownCode(() => lstsvToDataCsv(input, [{ 'q[a]': 'Y' }]))).toBe(
      'response-ambiguous',
    );
  });
});

describe('guard', () => {
  // Not reachable from an input today: no registered type lacks a LimeSurvey
  // mapping, and a broken registry fails at module load.
  const UNREACHABLE = new Set(['type-unsupported', 'registry-invalid']);

  test('every DiagnosticCode is named in some test', () => {
    const src = readFileSync(
      join(__dirname, '../../../src/diagnostics.ts'),
      'utf-8',
    );
    const union =
      /export type DiagnosticCode =([\s\S]*?);/.exec(src)?.[1] ?? '';
    const codes = [...union.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(20);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(readFileSync(p, 'utf-8'));
      }
    };
    walk(join(__dirname, '..'));
    const unnamed = codes.filter(
      (c) => !UNREACHABLE.has(c) && !files.some((f) => f.includes(`'${c}'`)),
    );
    expect(unnamed).toEqual([]);
  });
});
