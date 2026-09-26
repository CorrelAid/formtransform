/** Exported helpers that had no direct test (#92). */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as XLSX from 'xlsx';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { consoleWarning, warning } from '../../../src/diagnostics.js';
import type { Diagnostic } from '../../../src/diagnostics.js';
import { resolveFileChoices } from '../../../src/fileChoices.js';
import { ConfigManager, XLSFormParser } from '../../../src/internals.js';
import { defaultConfig } from '../../../src/config/types.js';

afterEach(() => vi.restoreAllMocks());

describe('consoleWarning', () => {
  test('forwards the message to console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleWarning(warning('name-truncated', 'too long', 'q1'));
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('too long');
  });
});

describe('resolveFileChoices', () => {
  test('loads CSVs beside the form, skips missing and registered ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ft-vocab-'));
    try {
      writeFileSync(join(dir, 'farben.csv'), 'code,label\nrot,Rot\n');
      const survey = [
        { type: 'select_one_from_file farben.csv', name: 'a' },
        { type: 'select_one_from_file fehlt.csv', name: 'b' },
        { type: 'select_one_from_file iso_3166_1.csv', name: 'c' },
      ];
      const found = resolveFileChoices(survey, dir);
      expect(found).toEqual({
        'farben.csv': [{ list_name: 'farben.csv', name: 'rot', label: 'Rot' }],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ConfigManager (deprecated)', () => {
  test('merges over the defaults; updateConfig replaces the options', () => {
    const cm = new ConfigManager({ convertMarkdown: false });
    expect(cm.getConfig().convertMarkdown).toBe(false);
    expect(cm.getDefaults()).toEqual(defaultConfig.defaults);
    cm.updateConfig({ hideNoAnswer: false });
    expect(cm.getConfig().hideNoAnswer).toBe(false);
    expect(cm.getConfig().convertMarkdown).toBe(defaultConfig.convertMarkdown);
    expect(() => cm.validateConfig()).not.toThrow();
  });

  test('an invalid config throws config-invalid', () => {
    expect(() => new ConfigManager({ handleRepeats: 'skip' as never })).toThrow(
      expect.objectContaining({ code: 'config-invalid' }),
    );
  });
});

describe('XLSFormParser (deprecated)', () => {
  // An unexpected column makes the loader warn.
  const workbook = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { type: 'text', name: 'q1', label: 'Q?', bogus_column: 'x' },
      ]),
      'survey',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ list_name: 'l', name: 'a', label: 'A' }]),
      'choices',
    );
    return wb;
  };

  test('convertXLSDataToTSV converts bytes; loader warnings reach onWarning', async () => {
    const warnings: Diagnostic[] = [];
    const buf = XLSX.write(workbook(), {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;
    const tsv = await XLSFormParser.convertXLSDataToTSV(buf, {
      onWarning: (w) => warnings.push(w),
    });
    expect(tsv).toMatch(/^class\t/);
    expect(tsv).toContain('\tq1\t');
    expect(warnings.map((w) => w.code)).toContain('column-unexpected');
  });

  test('convertXLSFileToTSV reads a path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ft-parser-'));
    try {
      const path = join(dir, 'f.xlsx');
      XLSX.writeFile(workbook(), path);
      const tsv = await XLSFormParser.convertXLSFileToTSV(path, {
        onWarning: () => {},
      });
      expect(tsv).toContain('\tq1\t');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
