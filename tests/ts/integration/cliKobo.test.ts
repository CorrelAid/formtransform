/**
 * `formtransform kobo list|pull|transform` end to end against a local mock of
 * the KoboToolbox API v2: two-page submissions, token checks, cache reuse.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const CLI = join(ROOT, 'dist/cli.js');
const TOKEN = 'test-token';
const UID = 'aTest123';

// Underscored names: Kobo forms are not held to the LimeSurvey name subset.
const FORM = XLSX.write(
  (() => {
    const wb = XLSX.utils.book_new();
    const sheets: Record<string, unknown[]> = {
      survey: [
        { type: 'begin_group', name: 'about_you', label: 'About you' },
        { type: 'text', name: 'full_name', label: 'Name' },
        { type: 'select_multiple fruit', name: 'fav_fruit', label: 'Fruit' },
        { type: 'end_group' },
        { type: 'integer', name: 'age', label: 'Age' },
      ],
      choices: [
        { list_name: 'fruit', name: 'apple', label: 'Apple' },
        { list_name: 'fruit', name: 'pear', label: 'Pear' },
      ],
      settings: [{ form_id: 'x' }],
    };
    for (const [name, rows] of Object.entries(sheets)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    }
    return wb;
  })(),
  { type: 'buffer', bookType: 'xlsx' },
) as Buffer;

let dir: string;
let server: ReturnType<typeof createServer>;
let base: string;
const hits: string[] = [];

function send(res: import('node:http').ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ft-kobo-'));

  server = createServer((req, res) => {
    const url = req.url ?? '';
    hits.push(url);
    if (req.headers.authorization !== `Token ${TOKEN}`) {
      res.writeHead(401, 'Unauthorized');
      return res.end('{}');
    }
    if (url === '/api/v2/assets/') {
      return send(res, {
        results: [
          { uid: UID, name: 'Mock survey', has_deployment: true },
          { uid: 'bDraft', name: 'Draft one', has_deployment: false },
        ],
      });
    }
    if (url === `/api/v2/assets/${UID}/`)
      return send(res, { uid: UID, name: 'Mock survey' });
    if (url === `/api/v2/assets/${UID}/data/?format=json`) {
      return send(res, {
        results: [
          {
            'about_you/full_name': 'Ada',
            'about_you/fav_fruit': 'pear apple',
            age: 36,
          },
        ],
        next: `${base}/api/v2/assets/${UID}/data/?format=json&start=1`,
      });
    }
    if (url === `/api/v2/assets/${UID}/data/?format=json&start=1`) {
      return send(res, {
        results: [{ 'about_you/full_name': 'Bo', age: 7 }],
        next: null,
      });
    }
    if (url === `/api/v2/assets/${UID}.xls`) {
      res.writeHead(200);
      return res.end(FORM);
    }
    res.writeHead(404, 'Not Found');
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Async spawn: the mock server shares this event loop. */
function kobo(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (done) => {
      execFile(
        process.execPath,
        [CLI, 'kobo', ...args],
        {
          cwd: dir,
          env: { PATH: process.env.PATH ?? '', KOBO_SERVER_URL: base, ...env },
        },
        (err, stdout, stderr) =>
          done({
            code: err ? ((err as { code?: number }).code ?? 1) : 0,
            stdout,
            stderr,
          }),
      );
    },
  );
}

const auth = { KOBO_API_TOKEN: TOKEN };

describe('formtransform kobo', () => {
  test('list prints uid, state and name', async () => {
    const r = await kobo(['list'], auth);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`${UID}\\s+deployed\\s+Mock survey`));
    expect(r.stdout).toMatch(/bDraft\s+draft\s+Draft one/);
  });

  test('a missing token fails before any request', async () => {
    const before = hits.length;
    const r = await kobo(['list']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/KOBO_API_TOKEN/);
    expect(hits.length).toBe(before);
  });

  test('--token overrides the env var', async () => {
    const r = await kobo(['list', '--token', 'wrong'], auth);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/401/);
    expect(r.stderr).not.toContain('wrong');
  });

  test('pull writes form.xlsx and both pages of submissions', async () => {
    const r = await kobo(['pull', UID, '-o', 'out'], auth);
    expect(r.code, r.stderr).toBe(0);
    const subs = JSON.parse(
      readFileSync(join(dir, 'out', UID, 'submissions.json'), 'utf-8'),
    );
    expect(subs).toHaveLength(2);
    expect(existsSync(join(dir, 'out', UID, 'form.xlsx'))).toBe(true);
  });

  test('transform writes <uid>.xml and <uid>.csv; title from the API', async () => {
    const r = await kobo(
      ['transform', UID, '-o', 'tx', '--prod-date', '2026-01-01'],
      auth,
    );
    expect(r.code, r.stderr).toBe(0);
    const xml = readFileSync(join(dir, 'tx', UID, `${UID}.xml`), 'utf-8');
    const csv = readFileSync(join(dir, 'tx', UID, `${UID}.csv`), 'utf-8');
    expect(xml).toMatch(/<caseQnty>2<\/caseQnty>/);
    expect(xml).toMatch(new RegExp(`<fileDscr ID="F1" URI="${UID}.csv"`));
    expect(xml).toContain('Mock survey');
    const names = [...xml.matchAll(/<var ID="[^"]*" name="([^"]*)"/g)].map(
      (m) => m[1],
    );
    const [header, row1] = csv.split('\r\n');
    expect(header.split(',')).toEqual(names);
    expect(row1).toBe('1,1,Ada,36');
  });

  test('transform reuses the cache without a token', async () => {
    const before = hits.length;
    const r = await kobo(['transform', UID, '-o', 'tx', '--title', 'Cached']);
    expect(r.code, r.stderr).toBe(0);
    expect(hits.length).toBe(before);
    expect(readFileSync(join(dir, 'tx', UID, `${UID}.xml`), 'utf-8')).toContain(
      'Cached',
    );
  });

  test('help for the group and each subcommand', async () => {
    for (const args of [
      ['--help'],
      ['list', '--help'],
      ['pull', '--help'],
      ['transform', '--help'],
    ]) {
      const r = await kobo(args);
      expect(r.code, args.join(' ')).toBe(0);
      expect(r.stdout).toMatch(/--token/);
    }
  });
});
