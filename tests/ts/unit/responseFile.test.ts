/** `--data` response-file reader — format detection, CSV dialects, JSON shapes. */
import { describe, test, expect } from 'vitest';

import { parseResponses } from '../../../src/responseFile.js';

describe('parseResponses — JSON', () => {
  test('reads a Kobo submissions array', () => {
    const rows = parseResponses(
      '[{"age": 30, "prefs/colors": "red blue"}, {"age": null}]',
      'submissions.json',
    );
    expect(rows).toEqual([
      { age: 30, 'prefs/colors': 'red blue' },
      { age: null },
    ]);
  });

  test('reads a raw API page { results: [...] }', () => {
    const rows = parseResponses(
      '{"count": 1, "results": [{"a": "x"}]}',
      'page.json',
    );
    expect(rows).toEqual([{ a: 'x' }]);
  });

  test('sniffs JSON without a .json extension', () => {
    expect(parseResponses('  \n[{"a": "1"}]', 'responses.txt')).toEqual([
      { a: '1' },
    ]);
  });

  test('rejects a non-array payload and non-object records', () => {
    expect(() => parseResponses('{"a": 1}', 'x.json')).toThrow(/results/);
    expect(() => parseResponses('[1]', 'x.json')).toThrow(/submission 0/);
  });
});

describe('parseResponses — CSV', () => {
  test('reads comma-delimited CSV keyed by header', () => {
    expect(parseResponses('a,b\r\n1,2\r\n3,\r\n', 'r.csv')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '' },
    ]);
  });

  test("sniffs Kobo's semicolon export", () => {
    expect(parseResponses('g/a;g/b\n1,5;2\n', 'r.csv')).toEqual([
      { 'g/a': '1,5', 'g/b': '2' },
    ]);
  });

  test('keeps quoted delimiters, doubled quotes and line breaks', () => {
    const csv = 'name,comment\n"Doe, J","said ""hi""\nthen left"\n';
    expect(parseResponses(csv, 'r.csv')).toEqual([
      { name: 'Doe, J', comment: 'said "hi"\nthen left' },
    ]);
  });

  test('drops a BOM and blank lines; pads short rows', () => {
    expect(parseResponses('﻿a,b\n\n1\n', 'r.csv')).toEqual([{ a: '1', b: '' }]);
  });

  test('rejects rows wider than the header and unterminated quotes', () => {
    expect(() => parseResponses('a\n1,2\n', 'r.csv')).toThrow(/row 2/);
    expect(() => parseResponses('a\n"open\n', 'r.csv')).toThrow(/unterminated/);
  });

  test('header-only file has no respondents', () => {
    expect(parseResponses('a,b\n', 'r.csv')).toEqual([]);
  });
});
