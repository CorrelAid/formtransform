/** `select_*_from_file` choice lists — registered vocabularies and caller CSVs (#24). */
import { describe, test, expect } from 'vitest';

import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index.js';
import { parseVocabCsv, registeredFileChoices } from '../../../src/vocab.js';

const survey = (type: string) => [{ type, name: 'land', label: 'Land' }];

describe('parseVocabCsv', () => {
  test('keeps commas inside quoted labels', () => {
    const rows = parseVocabCsv(
      'code,label\nKR,"Korea, Republic of"\nDE,Germany\n',
      'c.csv',
    );
    expect(rows).toEqual([
      { list_name: 'c.csv', name: 'KR', label: 'Korea, Republic of' },
      { list_name: 'c.csv', name: 'DE', label: 'Germany' },
    ]);
  });

  test('accepts a BOM, CRLF, any column order, and skips blank codes', () => {
    const rows = parseVocabCsv('\uFEFFLabel,Code\r\nYes,y\r\nNone,\r\n', 'l');
    expect(rows).toEqual([{ list_name: 'l', name: 'y', label: 'Yes' }]);
  });

  test('rejects a CSV without code and label columns', () => {
    expect(() => parseVocabCsv('id,name\n1,a\n', 'bad.csv')).toThrow(
      /must have 'code' and 'label'/,
    );
  });
});

describe('registeredFileChoices', () => {
  test('resolves a registered vocabulary without file access', () => {
    const choices = registeredFileChoices(
      survey('select_one_from_file iso_3166_1.csv'),
    );
    expect(choices['iso_3166_1.csv']).toContainEqual({
      list_name: 'iso_3166_1.csv',
      name: 'KR',
      label: 'Korea, Republic of',
    });
  });

  test('leaves unregistered files to the caller', () => {
    expect(
      registeredFileChoices(survey('select_one_from_file own.csv')),
    ).toEqual({});
  });
});

describe('convert with select_*_from_file', () => {
  test('inlines a registered vocabulary with no fileChoices argument', async () => {
    const tsv = await new XLSFormToTSVConverter().convert(
      survey('select_multiple_from_file iso_3166_1.csv'),
      [],
      [],
    );
    expect(tsv).toContain('cdlvocab-iso_3166_1');
    expect(tsv).toContain('\tKR\t\tKorea, Republic of\t');
  });

  test('explicit fileChoices add unregistered vocabularies', async () => {
    const tsv = await new XLSFormToTSVConverter().convert(
      survey('select_one_from_file own.csv'),
      [],
      [],
      { 'own.csv': parseVocabCsv('code,label\na,Alpha\n', 'own.csv') },
    );
    expect(tsv).toContain('\ta\t\tAlpha\t');
  });

  test('explicit fileChoices override a registered vocabulary', async () => {
    const tsv = await new XLSFormToTSVConverter().convert(
      survey('select_one_from_file iso_3166_1.csv'),
      [],
      [],
      {
        'iso_3166_1.csv': parseVocabCsv(
          'code,label\nXX,Only\n',
          'iso_3166_1.csv',
        ),
      },
    );
    expect(tsv).toContain('\tXX\t\tOnly\t');
    expect(tsv).not.toContain('Germany');
  });

  test('an unknown vocabulary still fails loudly', async () => {
    await expect(
      new XLSFormToTSVConverter().convert(
        survey('select_one_from_file own.csv'),
        [],
        [],
      ),
    ).rejects.toThrow(
      /'own.csv' is not a registered vocabulary \(registered: iso_3166_1.csv\)/,
    );
  });
});
