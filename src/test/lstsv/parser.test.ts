/** LimeSurvey structure-TSV line parsing / unescaping. */
import { describe, test, expect } from 'vitest';

import { parseLstsv } from '../../lstsv/parser.js';

describe('parseLstsv', () => {
  test('keys cells by header, missing trailing cells become empty', () => {
    const tsv = ['class\ttype/scale\tname\ttext', 'Q\tL\tq1\tLabel'].join('\n');
    const rows = parseLstsv(tsv);
    expect(rows).toEqual([
      { class: 'Q', 'type/scale': 'L', name: 'q1', text: 'Label' },
    ]);
  });

  test('unwraps quoted fields and unescapes doubled quotes', () => {
    const tsv = ['a\tb', 'x\t"say ""hi"" now"'].join('\n');
    expect(parseLstsv(tsv)[0].b).toBe('say "hi" now');
  });

  test('preserves tabs inside a quoted field', () => {
    const tsv = ['a\tb', '"left\tright"\tz'].join('\n');
    const row = parseLstsv(tsv)[0];
    expect(row.a).toBe('left\tright');
    expect(row.b).toBe('z');
  });

  test('ignores trailing blank lines', () => {
    const tsv = ['a\tb', '1\t2', '', ''].join('\n');
    expect(parseLstsv(tsv)).toHaveLength(1);
  });

  test('empty input yields no rows', () => {
    expect(parseLstsv('')).toEqual([]);
  });
});
