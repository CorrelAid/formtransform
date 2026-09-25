/** #63: structured errors and warnings instead of console output and plain Errors. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  ConversionError,
  FieldSanitizer,
  XLSFormToTSVConverter,
  xpathToLimeSurvey,
  parseResponses,
  resolveConfig,
} from '../../../src/index.js';
import type { Diagnostic } from '../../../src/index.js';

describe('warnings go to onWarning, with a code', () => {
  test('the converter reports through config.onWarning and not the console', async () => {
    const seen: Diagnostic[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await new XLSFormToTSVConverter({ onWarning: (w) => seen.push(w) }).convert(
      [
        {
          type: 'text',
          name: 'q',
          label: 'Q',
          appearance: 'no-such-appearance',
        },
        { type: 'integer', name: 'n', label: 'N', constraint: '^[0-9]+$' },
      ],
      [],
      [],
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(seen.map((w) => w.code)).toEqual(
      expect.arrayContaining(['appearance-unregistered', 'constraint-dropped']),
    );
    expect(seen.every((w) => w.severity === 'warning')).toBe(true);
  });

  test('FieldSanitizer takes a handler too', () => {
    const seen: Diagnostic[] = [];
    new FieldSanitizer((w) => seen.push(w)).sanitizeAnswerCode('verylong');
    expect(seen).toEqual([expect.objectContaining({ code: 'code-truncated' })]);
  });
});

describe('errors are ConversionErrors with a stable code', () => {
  const codeOf = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ConversionError);
      return (e as ConversionError).code;
    }
    throw new Error('did not throw');
  };

  test.each([
    [
      'unregistered type',
      () =>
        new XLSFormToTSVConverter().convert(
          [{ type: 'geopoint', name: 'g' }],
          [],
          [],
        ),
      'type-unregistered',
    ],
    [
      'empty choice list',
      () =>
        new XLSFormToTSVConverter().convert(
          [{ type: 'select_one x', name: 'q' }],
          [],
          [],
        ),
      'choice-list-empty',
    ],
    ['XPath syntax', () => xpathToLimeSurvey('${a} = = 1'), 'xpath-syntax'],
    [
      'XPath function',
      () => xpathToLimeSurvey('count-selected(.)'),
      'xpath-unsupported',
    ],
    [
      'response file',
      () => parseResponses('[1, 2]', 'r.json'),
      'responses-invalid',
    ],
    [
      'config',
      () => resolveConfig({ defaults: { language: 'deu' } as never }),
      'config-invalid',
    ],
    [
      'empty sanitized name',
      () => new FieldSanitizer().sanitizeName('日本'),
      'name-empty-after-sanitize',
    ],
  ])('%s', async (_, fn, code) => {
    expect(await codeOf(fn)).toBe(code);
  });

  test('the error names the question it concerns', async () => {
    const p = new XLSFormToTSVConverter().convert(
      [{ type: 'geopoint', name: 'wo' }] as never[],
      [],
      [],
    );
    await expect(p).rejects.toMatchObject({ subject: 'wo' });
  });
});

describe('the library writes to the console in one place only', () => {
  const SRC = resolve(__dirname, '../../../src');
  // CLI and node-only helpers print on purpose; the sink is diagnostics.ts.
  const ALLOWED = new Set([
    'cli.ts',
    'cliShared.ts',
    'fileChoices.ts',
    'generateFixtures.ts',
    'diagnostics.ts',
  ]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return n === 'generated' ? [] : files(p);
      return p.endsWith('.ts') && !ALLOWED.has(n) ? [p] : [];
    });

  test('no console.* outside diagnostics.ts and the CLI', () => {
    const code = (f: string) =>
      readFileSync(f, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    const hits = files(SRC).filter((f) =>
      /\bconsole\.(log|warn|error|info)\(/.test(code(f)),
    );
    expect(hits.map((f) => relative(SRC, f))).toEqual([]);
  });
});
