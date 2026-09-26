/**
 * formtransform#23 regression: the package must work as a strict-mode ESM
 * browser bundle. js-xpath broke there (a top-level `this.alert` and a bare
 * `require`) and every `relevant` silently became `1`.
 *
 * esbuild bundles `dist/index.js` for the browser (it rejects Node built-ins),
 * then the bundle is imported as ESM, where `this` is undefined and `require`
 * does not exist, and runs every conversion entry point on a question with
 * skip logic (#92).
 *
 * formtransform#24: `select_*_from_file` with a registered vocabulary converts
 * in the same bundle, with no filesystem to read the CSV from.
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

interface Fixture {
  survey: unknown[];
  choices: unknown[];
  settings?: unknown[];
}
const fixture = (slug: string) =>
  JSON.parse(
    readFileSync(
      join(ROOT, `registry/entities/${slug}/fixtures/xlsform.json`),
      'utf-8',
    ),
  ) as Fixture;

describe('browser bundle', () => {
  test('bundles for the browser; keeps skip logic and registered vocabularies', async () => {
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

    type Api = typeof import('../../../src/index.js');
    const lib = (await import(pathToFileURL(outfile).href)) as Pick<
      Api,
      | 'xlsformToLstsv'
      | 'xlsformToDdi'
      | 'lstsvToDdi'
      | 'lstsvToXlsform'
      | 'parseResponses'
    >;
    const sheets = (f: Fixture) => ({
      surveyData: f.survey as never,
      choicesData: f.choices as never,
      settingsData: (f.settings ?? []) as never,
    });
    const skipLogic: Fixture = {
      survey: [
        { type: 'select_one yn', name: 'a', label: 'A?' },
        { type: 'text', name: 'b', label: 'B?', relevant: "${a} = 'y'" },
      ],
      choices: [
        { list_name: 'yn', name: 'y', label: 'Ja' },
        { list_name: 'yn', name: 'n', label: 'Nein' },
      ],
    };

    const tsv = await lib.xlsformToLstsv(sheets(skipLogic));
    expect(tsv).toContain("b\ta == 'y'");

    const longList = await lib.xlsformToLstsv(
      sheets(fixture('select_one_long_list')),
    );
    expect(longList).toContain('cdlvocab-iso_3166_1');
    expect(longList).toContain('\tKR\t\tKorea, Republic of\t');

    // Every current entry point runs inside the bundle (#92).
    const xml = lib.xlsformToDdi(sheets(skipLogic), { prodDate: '2000-01-01' });
    expect(xml).toMatch(/<var ID="[^"]+" name="a"/);
    expect(lib.lstsvToDdi(tsv, { prodDate: '2000-01-01' })).toContain(
      'name="b"',
    );
    const back = lib.lstsvToXlsform(tsv);
    expect(back.survey.map((r) => r.name)).toEqual(['a', 'b']);
    expect(lib.parseResponses('a;b\ny;x\n', 'r.csv')).toEqual([
      { a: 'y', b: 'x' },
    ]);
  });
});
