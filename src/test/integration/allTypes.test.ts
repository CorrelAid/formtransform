import { describe, it, expect } from 'vitest';
import { XLSLoader, XLSFormToTSVConverter } from '../../index';
import { parseTSV, TSVRow } from '../helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  __dirname,
  '../../../tests/fixtures/surveys/all_types_survey/xlsform.xlsx',
);
const fixtureData = fs.readFileSync(fixturePath);
const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
  fixtureData,
  { skipValidation: true },
);

async function convertFixture(): Promise<TSVRow[]> {
  const converter = new XLSFormToTSVConverter();
  const tsv = await converter.convert(surveyData, choicesData, settingsData);
  return parseTSV(tsv);
}

// Helper: find first Q row by name
function findQ(rows: TSVRow[], name: string): TSVRow | undefined {
  return rows.find((r) => r.class === 'Q' && r.name === name);
}

describe('Integration: all_types_survey.json', () => {
  describe('skip types are absent', () => {
    it('should not contain any metadata skip types in output', async () => {
      const rows = await convertFixture();
      const allNames = rows.map((r) => r.name);
      for (const skip of [
        'start',
        'end',
        'today',
        'deviceid',
        'username',
        'hidden1',
        'audit',
      ]) {
        expect(allNames).not.toContain(skip);
      }
    });
  });

  describe('basic question types', () => {
    it('text → S', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qtext')!['type/scale']).toBe('S');
    });

    it('string → S', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qstring')!['type/scale']).toBe('S');
    });

    it('integer → N', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qinteger')!['type/scale']).toBe('N');
    });

    it('int → N', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qint')!['type/scale']).toBe('N');
    });

    it('decimal → N', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qdecimal')!['type/scale']).toBe('N');
    });

    it('date → D', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qdate')!['type/scale']).toBe('D');
    });

    it('time → D', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qtime')!['type/scale']).toBe('D');
    });

    it('select_one → L with A answers', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qselectone')!['type/scale']).toBe('L');
      const answers = rows.filter(
        (r) => r.class === 'A' && (r.name === 'yes' || r.name === 'no'),
      );
      expect(answers.length).toBeGreaterThanOrEqual(2);
    });

    it('select_multiple → M with SQ subquestions', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qselectmulti')!['type/scale']).toBe('M');
      const sqs = rows.filter(
        (r) => r.class === 'SQ' && ['red', 'blue', 'green'].includes(r.name),
      );
      expect(sqs.length).toBeGreaterThanOrEqual(3);
    });

    it('note → X', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qnote')!['type/scale']).toBe('X');
    });
  });

  describe('appearance modifiers', () => {
    it('text + multiline → T', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qmultilinetext')!['type/scale']).toBe('T');
    });

    it('string + multiline → T', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qmultilinestring')!['type/scale']).toBe('T');
    });

    it('select_one + likert → L (no change)', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qlikert')!['type/scale']).toBe('L');
    });

    it('select_one + minimal → ! (Dropdown)', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qminimal')!['type/scale']).toBe('!');
      // Should have A answer rows like a normal select_one
      const answers = rows.filter(
        (r) => r.class === 'A' && (r.name === 'yes' || r.name === 'no'),
      );
      expect(answers.length).toBeGreaterThanOrEqual(2);
    });

    it('select_one + label → F (matrix header)', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'matrixheader')!['type/scale']).toBe('F');
    });

    it('matrix has SQ subquestions for list-nolabel rows', async () => {
      const rows = await convertFixture();
      const matrixSQs = rows.filter(
        (r) =>
          r.class === 'SQ' &&
          ['skillpython', 'skilljs', 'skillsql'].includes(r.name),
      );
      expect(matrixSQs.length).toBeGreaterThanOrEqual(3);
    });

    it('matrix has A answer options from choice list', async () => {
      const rows = await convertFixture();
      // Find A rows after the matrix header
      const matrixAnswers = rows.filter(
        (r) =>
          r.class === 'A' && ['none', 'basic', 'adv', 'exp'].includes(r.name),
      );
      expect(matrixAnswers.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('or_other modifier', () => {
    it('select_one or_other → L with other=Y', async () => {
      const rows = await convertFixture();
      const q = findQ(rows, 'qsel1other');
      expect(q!['type/scale']).toBe('L');
      expect(q!.other).toBe('Y');
    });

    it('select_multiple or_other → M with other=Y', async () => {
      const rows = await convertFixture();
      const q = findQ(rows, 'qselmother');
      expect(q!['type/scale']).toBe('M');
      expect(q!.other).toBe('Y');
    });
  });

  describe('group structure', () => {
    it('should have named groups for groups with direct questions', async () => {
      const rows = await convertFixture();
      const groupNames = new Set(
        rows.filter((r) => r.class === 'G').map((r) => r.name),
      );
      for (const name of [
        'Persönliche Angaben',
        'Ausführliches Feedback',
        'Programmierkenntnisse',
        'Weitere Fragen',
        'Anmeldedaten',
      ]) {
        expect(groupNames).toContain(name);
      }
    });

    it('should flatten parent-only group (matrix_wrapper) to note', async () => {
      const rows = await convertFixture();
      const groupNames = new Set(
        rows.filter((r) => r.class === 'G').map((r) => r.name),
      );
      expect(groupNames).not.toContain(
        'Selbsteinschätzung technischer Fähigkeiten',
      );

      const noteRow = findQ(rows, 'matrixwrapper');
      expect(noteRow).toBeDefined();
      expect(noteRow!['type/scale']).toBe('X');
      expect(noteRow!.text).toBe('Selbsteinschätzung technischer Fähigkeiten');
    });

    it('should create auto-groups for orphan questions', async () => {
      const rows = await convertFixture();
      const groupNames = new Set(
        rows.filter((r) => r.class === 'G').map((r) => r.name),
      );

      // 5 named groups + 2 auto-generated for orphans = 7 total
      expect(groupNames.size).toBe(7);

      // orphan_before should be in a different group than basic_types questions
      const gAndQ = rows.filter((r) => r.class === 'G' || r.class === 'Q');
      let currentGroup = '';
      const questionGroup = new Map<string, string>();
      for (const r of gAndQ) {
        if (r.class === 'G') currentGroup = r.name;
        if (r.class === 'Q' && !questionGroup.has(r.name)) {
          questionGroup.set(r.name, currentGroup);
        }
      }
      expect(questionGroup.get('orphanbefore')).not.toBe(
        questionGroup.get('qtext'),
      );
      expect(questionGroup.get('orphanafter')).not.toBe(
        questionGroup.get('qmandatory'),
      );
    });
  });

  describe('question features', () => {
    it('required=yes → mandatory=Y', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qmandatory')!.mandatory).toBe('Y');
    });

    it('non-required question has empty mandatory', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qtext')!.mandatory).toBe('');
    });

    it('hint → help text', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qhint')!.help).toBe('Format: +49 123 456789'); // same in German
    });

    it('constraint → em_validation_q', async () => {
      const rows = await convertFixture();
      const q = rows.find((r) => r.class === 'Q' && r.name === 'qconstraint');
      expect(q).toBeDefined();
      // The constraint ". >= 18 and . <= 120" should be transpiled
      expect(q!.em_validation_q).toBeTruthy();
    });

    it('default value preserved', async () => {
      const rows = await convertFixture();
      expect(findQ(rows, 'qdefault')!.default).toBe('Deutschland');
    });

    it('relevant → relevance expression (not "1")', async () => {
      const rows = await convertFixture();
      const q = findQ(rows, 'qrelevant');
      expect(q!.relevance).not.toBe('1');
      expect(q!.relevance).toContain('qmandatory');
    });

    it('all features combined on one question', async () => {
      const rows = await convertFixture();
      const q = findQ(rows, 'qallfeatures');
      expect(q).toBeDefined();
      expect(q!.mandatory).toBe('Y');
      expect(q!.help).toBe('Freiwillig, aber willkommen');
      expect(q!.default).toBe('Keine Anmerkungen');
      expect(q!.relevance).not.toBe('1');
    });

    it('notes have no mandatory, other, default, or validation', async () => {
      const rows = await convertFixture();
      const q = findQ(rows, 'qnote');
      expect(q!.mandatory).toBe('');
      expect(q!.other).toBe('');
      expect(q!.default).toBe('');
      expect(q!.em_validation_q).toBe('');
    });
  });

  describe('overall integrity', () => {
    it('should have S, SL, G, Q rows', async () => {
      const rows = await convertFixture();
      const classes = new Set(rows.map((r) => r.class));
      expect(classes).toContain('S');
      expect(classes).toContain('SL');
      expect(classes).toContain('G');
      expect(classes).toContain('Q');
      expect(classes).toContain('A');
      expect(classes).toContain('SQ');
    });

    it('should preserve question order', async () => {
      const rows = await convertFixture();
      const qNames: string[] = [];
      for (const r of rows) {
        if (r.class === 'Q' && !qNames.includes(r.name)) {
          qNames.push(r.name);
        }
      }
      const idx = (name: string) => qNames.indexOf(name);

      // orphan_before → basic types → appearances → matrix → or_other → features → orphan_after
      expect(idx('orphanbefore')).toBeLessThan(idx('qtext'));
      expect(idx('qtext')).toBeLessThan(idx('qnote'));
      expect(idx('qnote')).toBeLessThan(idx('qmultilinetext'));
      expect(idx('qmultilinetext')).toBeLessThan(idx('matrixheader'));
      expect(idx('matrixheader')).toBeLessThan(idx('qsel1other'));
      expect(idx('qsel1other')).toBeLessThan(idx('qmandatory'));
      expect(idx('qmandatory')).toBeLessThan(idx('orphanafter'));
    });
  });
});
