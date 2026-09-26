/** TSVGenerator escaping, read back by parseLstsv (#106). */
import { describe, expect, test } from 'vitest';

import { TSVGenerator } from '../../../../src/lstsv/serialize.js';
import type { TSVRow } from '../../../../src/lstsv/serialize.js';
import { parseLstsv } from '../../../../src/lstsv/parser.js';

const row = (text: string): TSVRow => ({
  class: 'Q',
  'type/scale': 'S',
  name: 'q',
  relevance: '1',
  text,
  help: '',
  language: 'en',
  validation: '',
  em_validation_q: '',
  mandatory: '',
  other: '',
  default: '',
  same_default: '',
});

const roundTrip = (text: string) => {
  const gen = new TSVGenerator();
  gen.addRow(row(text));
  return parseLstsv(gen.generateTSV())[0].text;
};

describe('TSV escaping', () => {
  test.each([
    ['a tab', 'a\tb'],
    ['a double quote', 'say "hi"'],
    ['both', '"x"\ty'],
    ['plain text', 'plain'],
  ])('%s survives serialize → parse', (_, text) => {
    expect(roundTrip(text)).toBe(text);
  });

  test('newlines become <br /> (LimeSurvey reads the TSV line by line)', () => {
    expect(roundTrip('one\ntwo\r\nthree')).toBe('one<br />two<br />three');
  });
});
