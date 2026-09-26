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

describe('parseResponses — CSV dialect edges (#107)', () => {
  test('a ; / , tie in the header picks ","', () => {
    expect(parseResponses('a;b,c\n1;2,3\n', 'r.csv')).toEqual([
      { 'a;b': '1;2', c: '3' },
    ]);
  });

  test('a quote inside an unquoted field is kept literally', () => {
    expect(parseResponses('a,b\nsay "hi",x\n', 'r.csv')).toEqual([
      { a: 'say "hi"', b: 'x' },
    ]);
  });

  test('bare CR line endings split rows', () => {
    expect(parseResponses('a,b\r1,2\r3,4\r', 'r.csv')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  test('a duplicate header: the last column wins', () => {
    expect(parseResponses('a,a\n1,2\n', 'r.csv')).toEqual([{ a: '2' }]);
  });

  test('tab-delimited input is not sniffed: one column', () => {
    expect(parseResponses('a\tb\n1\t2\n', 'r.csv')).toEqual([
      { 'a\tb': '1\t2' },
    ]);
  });

  test('the extension is matched case-insensitively', () => {
    expect(parseResponses('[{"a":1}]', 'EXPORT.JSON')).toEqual([{ a: 1 }]);
    expect(parseResponses('a\n1\n', 'EXPORT.CSV')).toEqual([{ a: '1' }]);
  });

  test('values pass through uncoerced: decimal comma, time, Kobo dateTime', () => {
    const [row] = parseResponses(
      'd;t;dt\n1,5;10:00:00.000+02:00;2024-05-01T10:00:00.000+02:00\n',
      'r.csv',
    );
    expect(row).toEqual({
      d: '1,5',
      t: '10:00:00.000+02:00',
      dt: '2024-05-01T10:00:00.000+02:00',
    });
  });
});

describe('parseResponses — malformed JSON (#101)', () => {
  test('is responses-invalid, not a SyntaxError', () => {
    expect(() => parseResponses('[{', 'x.json')).toThrow(
      expect.objectContaining({ code: 'responses-invalid' }),
    );
  });
});
