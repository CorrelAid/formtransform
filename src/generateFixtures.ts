#!/usr/bin/env node
/**
 * Generate TSV files from XLSForm fixtures for integration testing.
 *
 * This script:
 * 1. Reads each whole-survey fixture from tests/fixtures/surveys/<name>/
 *    (xlsform.json or xlsform.xlsx — one folder per survey, mirroring
 *    registry/entities/<slug>/)
 * 2. Converts it to LimeSurvey TSV format
 * 3. Saves output to tests/live/limesurvey/output/<name>.tsv
 *
 * The blessed forward snapshots inside each fixture folder (tsv.tsv, ddi.xml)
 * are written by scripts/bless-survey-snapshots.mjs, not here — this script
 * only feeds the live-import suite.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  SurveyRow,
  ChoiceRow,
  SettingsRow,
  ConversionConfig,
} from './config/types.js';
import { XLSLoader } from './xlsform/loader.js';
import { XLSFormToTSVConverter } from './pipelines/xlsform2lstsv/index.js';

interface XLSFormFixture {
  survey: SurveyRow[];
  choices: ChoiceRow[];
  settings: SettingsRow[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/surveys');
const OUTPUT_DIR = path.join(__dirname, '../tests/live/limesurvey/output');

function ensureDirectoryExists(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanOutputDirectory(dir: string): void {
  if (fs.existsSync(dir)) {
    // Remove all .tsv files in the output directory
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.tsv')) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  }
}

async function generateTSVFromFixture(
  fixturePath: string,
  outputPath: string,
  config: Partial<ConversionConfig> = {},
): Promise<void> {
  console.log(`Processing: ${path.basename(fixturePath)}`);

  // Read fixture
  const fixtureContent = fs.readFileSync(fixturePath, 'utf-8');
  const fixture: XLSFormFixture = JSON.parse(fixtureContent) as XLSFormFixture;

  // Convert to TSV with configuration that removes underscores but doesn't truncate field names
  // This matches LimeSurvey's behavior (removes underscores but allows longer field names)
  // Answer codes are already limited to 5 chars in the fixtures
  const converter = new XLSFormToTSVConverter(config);
  const tsv = await converter.convert(
    fixture.survey,
    fixture.choices,
    fixture.settings,
  );

  // Write output
  fs.writeFileSync(outputPath, tsv, 'utf-8');
  console.log(`  → Generated: ${path.basename(outputPath)}`);

  // Print stats
  const lines = tsv.split('\n').filter((l) => l.trim()).length;
  console.log(`  → ${lines} rows (including header)`);
}

async function generateTSVFromXLSX(
  xlsxPath: string,
  outputPath: string,
): Promise<void> {
  console.log(`Processing: ${path.basename(xlsxPath)}`);

  // Read and parse xlsx file
  const fileData = fs.readFileSync(xlsxPath);
  const { surveyData, choicesData, settingsData } = XLSLoader.parseXLSData(
    fileData,
    { skipValidation: true },
  );

  // Convert to TSV
  const converter = new XLSFormToTSVConverter({});
  const tsv = await converter.convert(surveyData, choicesData, settingsData);

  // Write output
  fs.writeFileSync(outputPath, tsv, 'utf-8');
  console.log(`  → Generated: ${path.basename(outputPath)}`);

  // Print stats
  const lines = tsv.split('\n').filter((l) => l.trim()).length;
  console.log(`  → ${lines} rows (including header)`);
}

async function main(): Promise<void> {
  console.log('Generating TSV files from XLSForm fixtures...\n');

  // Ensure output directory exists and clean old files
  ensureDirectoryExists(OUTPUT_DIR);
  cleanOutputDirectory(OUTPUT_DIR);
  console.log('Cleaned output directory\n');

  // One folder per survey; its source is xlsform.json or xlsform.xlsx.
  const surveyDirs = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const jsonFiles = surveyDirs
    .map((name) => path.join(FIXTURES_DIR, name, 'xlsform.json'))
    .filter((p) => fs.existsSync(p));
  const xlsxFiles = surveyDirs
    .map((name) => path.join(FIXTURES_DIR, name, 'xlsform.xlsx'))
    .filter((p) => fs.existsSync(p));

  const totalFiles = jsonFiles.length + xlsxFiles.length;
  if (totalFiles === 0) {
    console.error('No fixture files found in', FIXTURES_DIR);
    process.exit(1);
  }

  // Generate TSV for each JSON fixture
  let jsonSuccessCount = 0;
  for (const fixturePath of jsonFiles) {
    const baseName = path.basename(path.dirname(fixturePath));
    const outputPath = path.join(OUTPUT_DIR, `${baseName}.tsv`);

    try {
      await generateTSVFromFixture(fixturePath, outputPath);
      jsonSuccessCount++;
    } catch (error) {
      console.error(`  ✗ Error processing ${baseName}:`, error);
    }
    console.log('');
  }

  // Generate settings variant: same fixture with all conversion settings disabled
  const settingsFixturePath = path.join(
    FIXTURES_DIR,
    'settings_survey',
    'xlsform.json',
  );
  if (fs.existsSync(settingsFixturePath)) {
    const variantPath = path.join(OUTPUT_DIR, 'settings_survey_disabled.tsv');
    try {
      await generateTSVFromFixture(settingsFixturePath, variantPath, {
        convertWelcomeNote: false,
        convertEndNote: false,
        convertOtherPattern: false,
        convertMarkdown: false,
      });
      jsonSuccessCount++;
    } catch (error) {
      console.error('  ✗ Error processing settings_survey_disabled:', error);
    }
    console.log('');
  }

  // Generate TSV for each XLSX fixture
  // XLSX files may contain unimplemented types (e.g. range) — failures are logged but not fatal
  let xlsxSuccessCount = 0;
  for (const xlsxPath of xlsxFiles) {
    const baseName = path.basename(path.dirname(xlsxPath));
    const outputPath = path.join(OUTPUT_DIR, `${baseName}.tsv`);

    try {
      await generateTSVFromXLSX(xlsxPath, outputPath);
      xlsxSuccessCount++;
    } catch (error) {
      console.warn(`  ⚠ Skipped ${baseName}:`, (error as Error).message);
    }
    console.log('');
  }

  const totalSuccess = jsonSuccessCount + xlsxSuccessCount;
  console.log(
    `\nFinal Summary: ${totalSuccess}/${totalFiles} files generated successfully`,
  );

  // Only fail if JSON fixtures (which should always succeed) had errors
  if (jsonSuccessCount < jsonFiles.length) {
    process.exit(1);
  }
}
void (async () => {
  await main();
})();
