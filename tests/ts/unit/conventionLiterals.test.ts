/**
 * #60: registry convention values have one implementation, in src/conventions/
 * (read from src/generated/). Anywhere else a literal copy silently ignores a
 * registry change, so this test fails on one.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const SRC = resolve(__dirname, '../../../src');
const ALLOWED = ['generated', 'conventions'];

/** Convention values that must not be written out as string literals. */
const FORBIDDEN: [string, RegExp][] = [
  ['other companion suffix', /['"`]_other['"`]/],
  ['from-file type', /['"`]select_(one|multiple)_from_file['"`]/],
  ['vocabulary cssclass prefix', /['"`]cdlvocab-/],
  ['grid appearance', /['"`]table-list['"`]/],
  ['other labels', /['"`]Sonstiges['"`]/],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ALLOWED.includes(name) && dir === SRC ? [] : sourceFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Code only: drop line and block comments so documentation may name values. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('convention values live in src/conventions only', () => {
  test.each(FORBIDDEN)(
    'no %s literal outside src/conventions',
    (_, pattern) => {
      const hits = sourceFiles(SRC).filter((f) =>
        pattern.test(stripComments(readFileSync(f, 'utf-8'))),
      );
      expect(hits.map((f) => relative(SRC, f))).toEqual([]);
    },
  );
});
