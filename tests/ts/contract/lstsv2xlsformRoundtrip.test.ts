/**
 * Round-trip parity: committed `tsv.tsv` → lstsv2xlsform vs the original
 * `xlsform.json`.
 *
 * Two fields are structurally-but-not-literally lossy (see
 * `src/lstsv2xlsform/README.md`) and are normalized away before comparing:
 *   - the `type` string's list-name / filename suffix on select_one and
 *     select_multiple (the authored list name is not stored anywhere in the
 *     TSV; it is re-synthesized from the question's own name);
 *   - `integer` vs `decimal` (both emit LimeSurvey `N`, with no
 *     distinguishing signal — `decimal` is the canonical default).
 * Every other field — names, labels, choice codes/labels/order, groups,
 * appearances, the `other` pattern, settings — must match exactly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from 'vitest';

import { lstsvToXlsform } from '../../../src/pipelines/lstsv2xlsform/index.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const REGISTRY_DIR = path.join(REPO_ROOT, 'registry', 'entities');

/** Strip the list-name/filename suffix so a synthesized name doesn't fail
 * comparison; keep only the base type (`select_one`, `select_one_from_file`, …). */
function normalizeType(type: string): string {
  const base = type.split(/\s+/)[0];
  return base === 'integer' ? 'decimal' : base;
}

function normalizeSurvey(rows: Record<string, unknown>[]): unknown[] {
  return rows.map((r) => ({ ...r, type: normalizeType(String(r.type ?? '')) }));
}

function normalizeChoices(rows: Record<string, unknown>[]): unknown[] {
  return rows.map(({ list_name, ...rest }) => rest);
}

interface Case {
  id: string;
  dir: string;
}

function discoverCases(): Case[] {
  const cases: Case[] = [];
  for (const slug of fs.readdirSync(REGISTRY_DIR).sort()) {
    const dir = path.join(REGISTRY_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (
      fs.existsSync(path.join(dir, 'tsv.tsv')) &&
      fs.existsSync(path.join(dir, 'xlsform.json'))
    ) {
      cases.push({ id: slug, dir });
    }
  }
  return cases;
}

const cases = discoverCases();

describe('lstsv2xlsform round-trip', () => {
  test('there are committed fixtures to compare against', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases)(
    '$id matches the original xlsform.json (mod. list-name / int-vs-decimal)',
    ({ dir }) => {
      const tsv = fs.readFileSync(path.join(dir, 'tsv.tsv'), 'utf-8');
      const original = JSON.parse(
        fs.readFileSync(path.join(dir, 'xlsform.json'), 'utf-8'),
      );
      const observed = lstsvToXlsform(tsv);

      expect(normalizeSurvey(observed.survey)).toEqual(
        normalizeSurvey(original.survey ?? []),
      );
      expect(normalizeChoices(observed.choices)).toEqual(
        normalizeChoices(original.choices ?? []),
      );
    },
  );
});
