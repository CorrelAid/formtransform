/**
 * formtransform#23 regression: the package must work as a strict-mode ESM
 * browser bundle. js-xpath broke there (a top-level `this.alert` and a bare
 * `require`) and every `relevant` silently became `1`.
 *
 * esbuild bundles `dist/index.js` for the browser (it rejects Node built-ins),
 * then the bundle is imported as ESM, where `this` is undefined and `require`
 * does not exist, and converts the `select_one_other` example from the issue.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { afterAll, describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const dir = mkdtempSync(join(tmpdir(), 'ft-bundle-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('browser bundle', () => {
  test('bundles for the browser and keeps skip logic', async () => {
    const outfile = join(dir, 'formtransform.browser.mjs');
    await build({
      entryPoints: [join(ROOT, 'dist/index.js')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      outfile,
      logLevel: 'silent',
    });
    const bundle = readFileSync(outfile, 'utf-8');
    expect(bundle).not.toMatch(/\brequire\(\s*["']/);

    const lib = (await import(pathToFileURL(outfile).href)) as {
      XLSFormToTSVConverter: new () => {
        convert(s: unknown[], c: unknown[], st: unknown[]): Promise<string>;
      };
    };
    const fixture = JSON.parse(
      readFileSync(
        join(ROOT, 'registry/entities/select_one_other/fixtures/xlsform.json'),
        'utf-8',
      ),
    ) as { survey: unknown[]; choices: unknown[]; settings?: unknown[] };
    const tsv = await new lib.XLSFormToTSVConverter().convert(
      fixture.survey,
      fixture.choices,
      fixture.settings ?? [],
    );
    expect(tsv).toContain("aufmerksamother\taufmerksam == 'other'");
  });
});
