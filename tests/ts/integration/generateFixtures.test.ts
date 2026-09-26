/**
 * `dist/generateFixtures.js` feeds the live-import suite: one TSV per survey
 * fixture folder in tests/live/limesurvey/output/ (#92).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SURVEYS = join(ROOT, 'tests/fixtures/surveys');
const OUTPUT = join(ROOT, 'tests/live/limesurvey/output');

test('writes one TSV per survey folder, plus the settings variant', () => {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'dist/generateFixtures.js')],
    {
      encoding: 'utf-8',
    },
  );
  expect(r.status, r.stderr).toBe(0);

  const surveys = readdirSync(SURVEYS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${e.name}.tsv`);
  const written = readdirSync(OUTPUT).filter((f) => f.endsWith('.tsv'));
  expect(written.sort()).toEqual(
    [...surveys, 'settings_survey_disabled.tsv'].sort(),
  );
  for (const f of written) {
    expect(readFileSync(join(OUTPUT, f), 'utf-8'), f).toMatch(/^class\t/);
  }
});
