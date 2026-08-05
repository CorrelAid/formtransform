import { describe, it, expect } from 'vitest';
import { XLSLoader, XLSFormToTSVConverter } from '../../../src/index';
import { parseTSV } from '../unit/helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFilePath = path.join(
  __dirname,
  '../../../tests/fixtures/surveys/testB/xlsform.xlsx',
);
const testFileData = fs.readFileSync(testFilePath);

describe('Integration: testB.xlsx', () => {
  it('should load the xlsx file', () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    expect(surveyData.length).toBeGreaterThan(0);
    expect(choicesData.length).toBeGreaterThan(0);
    expect(settingsData.length).toBeGreaterThan(0);
  });

  it('should convert without throwing', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    expect(tsv).toBeTruthy();
  });

  it('should silently skip start and end metadata types', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    const rows = parseTSV(tsv);

    // start/end rows should not appear in the output
    expect(rows.find((r) => r['type/scale'] === 'start')).toBeUndefined();
    expect(rows.find((r) => r['type/scale'] === 'end')).toBeUndefined();
  });

  it('should produce matrix questions (type F) for label/list-nolabel patterns', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    const rows = parseTSV(tsv);

    // The tools matrix header should be type F (Array)
    // Name is deduplicated: rating_technologies_tools already claims 'ratingtechnologiesto'
    const toolsMatrix = rows.filter(
      (r) => r.name === 'ratingtechnologiest1' && r.class === 'Q',
    );
    expect(toolsMatrix.length).toBeGreaterThan(0);
    expect(toolsMatrix[0]['type/scale']).toBe('F');

    // There should be SQ rows for the subquestions (e.g. soscisurvey)
    const subquestions = rows.filter(
      (r) => r.class === 'SQ' && r.name === 'soscisurvey',
    );
    expect(subquestions.length).toBeGreaterThan(0);

    // There should be A rows for the shared answer options (beginner, user, etc.)
    const answers = rows.filter((r) => r.class === 'A' && r.name === 'begin');
    expect(answers.length).toBeGreaterThan(0);
  });

  it('should transpile relevant expressions with hyphens in variable names', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    const rows = parseTSV(tsv);

    // The sosci_survey subquestion should have a proper relevance expression
    // original: selected(${project_role_project-alpha}, 'role-survey-design')
    // project_role_project-alpha → projectroleprojectal (20 char truncation)
    // role-survey-design → roles (remove hyphens → rolesurveydesign → truncate to 5)
    // select_multiple → fieldname_code.NAOK == "Y"
    const sqRow = rows.find(
      (r) => r.class === 'SQ' && r.name === 'soscisurvey',
    );
    expect(sqRow).toBeDefined();
    expect(sqRow!.relevance).toContain(
      "projectroleprojectal_roles.NAOK == 'Y'",
    );

    // Project-beta role relevance: selected(${project_role_project-beta}, 'role-visualization')
    // project_role_project-beta → projectroleprojectbe (20 char truncation)
    // role-visualization → rolev
    const powerbiRow = rows.find(
      (r) => r.class === 'SQ' && r.name === 'powerbi',
    );
    expect(powerbiRow).toBeDefined();
    expect(powerbiRow!.relevance).toContain(
      "projectroleprojectbe_rolev.NAOK == 'Y'",
    );

    // Project-gamma role relevance: selected(${project_role_project-gamma}, 'role-machine-learning')
    // project_role_project-gamma → projectroleprojectga (20 char truncation)
    // role-machine-learning → rolem
    const jupyterRow = rows.find(
      (r) => r.class === 'SQ' && r.name === 'jupyter',
    );
    expect(jupyterRow).toBeDefined();
    expect(jupyterRow!.relevance).toContain(
      "projectroleprojectga_rolem.NAOK == 'Y'",
    );

    // Simple equality relevant: ${past_applications} = 'not_successful'
    // past_applications is select_one (type L) → fieldname.NAOK=="code"
    // not_successful → notsu (remove underscore → notsuccessful → truncate to 5)
    const pastDetailsRow = rows.find(
      (r) => r.name === 'pastapplicationsdeta' && r.class === 'Q',
    );
    expect(pastDetailsRow).toBeDefined();
    expect(pastDetailsRow!.relevance).toContain('pastapplications');
    expect(pastDetailsRow!.relevance).toContain('notsu');
  });

  it('should preserve correct question ordering from the survey sheet', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    const rows = parseTSV(tsv);

    // Extract Q-class rows (questions) in order, deduplicate by name (multilingual rows)
    const questionNames: string[] = [];
    for (const r of rows) {
      if (r.class === 'Q' && !questionNames.includes(r.name)) {
        questionNames.push(r.name);
      }
    }

    // Verify key ordering: notes -> project -> roles -> skills -> demographics
    const indexOf = (name: string) => questionNames.indexOf(name);
    expect(indexOf('Hallo')).toBeLessThan(indexOf('projectid'));
    expect(indexOf('projectid')).toBeLessThan(indexOf('projectroleprojectal'));
    expect(indexOf('projectroleprojectal')).toBeLessThan(
      indexOf('projectroleprojectbe'),
    );
    expect(indexOf('projectroleprojectbe')).toBeLessThan(
      indexOf('projectroleprojectga'),
    );
    expect(indexOf('projectroleprojectga')).toBeLessThan(
      indexOf('ratingtechnologiest1'),
    );
    expect(indexOf('ratingtechnologiest1')).toBeLessThan(
      indexOf('ratingtechniqueshead'),
    );
    expect(indexOf('ratingtechniqueshead')).toBeLessThan(
      indexOf('ratingtopicsheader'),
    );
    expect(indexOf('motivationskills')).toBeLessThan(indexOf('firstname'));
    expect(indexOf('gender')).toBeLessThan(indexOf('consentprivacypolicy'));
  });

  it('should produce correct groups (parent-only flattened, orphans get auto-groups)', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    const rows = parseTSV(tsv);

    // Count distinct groups by type/scale key (stable across languages)
    const groupKeys = new Set<string>();
    const groupNamesDe = new Set<string>();
    for (const r of rows) {
      if (r.class === 'G') {
        groupKeys.add(r['type/scale']);
        if (r.language === 'de') groupNamesDe.add(r.name);
      }
    }

    // grouplt58n55 is parent-only (no direct questions, only child groups)
    // so it gets flattened into a note question instead of a G row
    // Group names are now labels (displayed as group titles in LimeSurvey)
    expect(groupNamesDe).not.toContain('Deine Fähigkeiten und Erfahrungen');

    // Named groups from the XLSForm — group name is the label (de)
    for (const group of [
      'Hallo!',
      'Tools',
      'Techniken',
      'Themen',
      'Du und das Projekt',
      'Über dich',
    ]) {
      expect(groupNamesDe).toContain(group);
    }

    // Orphan questions (outside any group) get auto-generated groups:
    // - project_id and project_role_* are between groupgi4rv46 and grouplt58n55
    // - consent_privacy_policy is after demographics
    // Count by type/scale key (unique per group, shared across languages)
    expect(groupKeys.size).toBe(8);

    // projectroleprojectal must NOT be in the same group as Hallo
    const gRows = rows.filter((r) => r.class === 'G' || r.class === 'Q');
    let currentGroup = '';
    const questionGroup = new Map<string, string>();
    for (const r of gRows) {
      if (r.class === 'G') currentGroup = r['type/scale'];
      if (r.class === 'Q') {
        if (!questionGroup.has(r.name)) questionGroup.set(r.name, currentGroup);
      }
    }
    expect(questionGroup.get('Hallo')).not.toBe(
      questionGroup.get('projectroleprojectal'),
    );

    // grouplt58n55 should appear as a note question (type X) in the first child group
    const noteRow = rows.find(
      (r) => r.class === 'Q' && r.name === 'grouplt58n55',
    );
    expect(noteRow).toBeDefined();
    expect(noteRow!['type/scale']).toBe('X');
  });

  it('should have unique answer/subquestion names per question', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    const rows = parseTSV(tsv);

    // Group SQ and A rows by their parent question (the preceding Q row)
    let currentQuestion = '';
    const namesByQuestion = new Map<string, Map<string, string[]>>();

    for (const row of rows) {
      if (row.class === 'Q') {
        currentQuestion = row.name;
      } else if ((row.class === 'SQ' || row.class === 'A') && currentQuestion) {
        if (!namesByQuestion.has(currentQuestion)) {
          namesByQuestion.set(currentQuestion, new Map());
        }
        const langNames = namesByQuestion.get(currentQuestion)!;
        if (!langNames.has(row.language)) {
          langNames.set(row.language, []);
        }
        langNames.get(row.language)!.push(row.name);
      }
    }

    // For each question and language, check that names are unique
    for (const [question, langNames] of namesByQuestion) {
      for (const [lang, names] of langNames) {
        const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
        expect(
          duplicates,
          `Question "${question}" (${lang}) has duplicate answer codes: ${duplicates.join(', ')}`,
        ).toEqual([]);
      }
    }
  });

  it('should produce both languages (de and en)', async () => {
    const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
      testFileData,
      { skipValidation: true },
    );

    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, settingsData);
    const rows = parseTSV(tsv);

    const deRows = rows.filter((r) => r.language === 'de');
    const enRows = rows.filter((r) => r.language === 'en');
    expect(deRows.length).toBeGreaterThan(0);
    expect(enRows.length).toBeGreaterThan(0);
  });
});
