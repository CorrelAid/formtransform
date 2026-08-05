#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs, ParseArgsConfig } from 'node:util';

import { ConversionConfig } from './config/ConfigManager.js';
import { XLSFormData } from './config/types.js';
import { resolveFileChoices } from './fileChoices.js';
import { lstsvToDdiXml } from './pipelines/lstsv2ddi/index.js';
import { lstsvToXlsform } from './pipelines/lstsv2xlsform/index.js';
import { buildDdiXml } from './pipelines/xlsform2ddi/index.js';
import { XLSFormToTSVConverter } from './pipelines/xlsform2lstsv/index.js';
import { XLSLoader } from './xlsform/loader.js';
import { XLSValidator } from './xlsform/validate.js';

const PROG = 'formtransform';

function die(msg: string): never {
  process.stderr.write(`${PROG}: ${msg}\n`);
  process.exit(1);
}

// ── Shared helpers ─────────────────────────────────────────────────────

type ParsedValues = Record<string, string | boolean | undefined>;

/** Parse argv against a spec, exiting with a clean message on failure. */
function parse(
  argv: string[],
  options: ParseArgsConfig['options'],
): { values: ParsedValues; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options,
    });
    return { values, positionals };
  } catch (err) {
    return die((err as Error).message);
  }
}

/** Resolve a single required positional .xlsx path and read its bytes. */
function readInput(positionals: string[], usage: () => void): Buffer {
  if (positionals.length === 0) {
    usage();
    die('missing input .xlsx path');
  }
  if (positionals.length > 1) {
    die(`unexpected extra arguments: ${positionals.slice(1).join(', ')}`);
  }
  try {
    return readFileSync(positionals[0]);
  } catch {
    return die(`cannot read input file: ${positionals[0]}`);
  }
}

/** Parse an XLSForm workbook from bytes, exiting cleanly on failure. */
function loadXlsform(bytes: Buffer, skipValidation: boolean): XLSFormData {
  try {
    return XLSLoader.parseXLSData(bytes, { skipValidation });
  } catch (err) {
    return die(`failed to parse XLSForm: ${(err as Error).message}`);
  }
}

/** Write to a file (with a stderr notice) or to stdout. */
function emit(content: string, output: string | undefined): void {
  if (output) {
    writeFileSync(output, content, 'utf-8');
    process.stderr.write(`Wrote ${output}\n`);
  } else {
    process.stdout.write(content);
  }
}

// ── Help text ──────────────────────────────────────────────────────────

function topHelp(): void {
  process.stdout.write(
    `${PROG} — transform surveys via the CDL canonical survey model

Usage:
  ${PROG} <command> [options]

Commands:
  validate        Check an XLSForm (.xlsx) against the supported XLSForm subset
  xlsform2lstsv   Convert an XLSForm (.xlsx) to a LimeSurvey structure TSV
  xlsform2ddi     Convert an XLSForm (.xlsx) to a DDI-Codebook 2.5 XML
  lstsv2ddi       Convert a LimeSurvey structure TSV to a DDI-Codebook 2.5 XML
  lstsv2xlsform   Convert a LimeSurvey structure TSV to an XLSForm (.json)

Run "${PROG} <command> --help" for command options.
`,
  );
}

function xlsform2lstsvHelp(): void {
  process.stdout.write(
    `${PROG} xlsform2lstsv — XLSForm (.xlsx) → LimeSurvey structure TSV

Usage:
  ${PROG} xlsform2lstsv <input.xlsx> [-o output.tsv] [options]

Arguments:
  input.xlsx              Path to the XLSForm workbook (survey/choices/settings sheets)

Options:
  -o, --output <file>     Write TSV to <file> (default: stdout)
      --title <text>      Override the survey title
      --language <code>   Default language code (default: en, or settings default_language)
      --no-markdown       Do not render markdown labels/hints to HTML
      --no-welcome-note   Do not promote a "welcome" note to surveyls_welcometext
      --no-end-note       Do not promote an "end" note to surveyls_endtext
      --no-other-pattern  Do not collapse the _other question pattern into a native "other"
      --show-no-answer    Keep the "no answer" option on non-mandatory questions
      --skip-validation   Skip XLSForm sheet/column validation
  -h, --help              Show this help
`,
  );
}

function xlsform2ddiHelp(): void {
  process.stdout.write(
    `${PROG} xlsform2ddi — XLSForm (.xlsx) → DDI-Codebook 2.5 XML

Usage:
  ${PROG} xlsform2ddi <input.xlsx> [-o output.xml] [options]

Arguments:
  input.xlsx                 Path to the XLSForm workbook (survey/choices/settings sheets)

Options:
  -o, --output <file>        Write XML to <file> (default: stdout)
      --title <text>         Study title (default: settings form_title, then "Untitled")
      --dataset-filename <n>  Data file URI recorded in <fileDscr> (default: data.csv)
      --prod-date <date>     Override the prodDate (ISO YYYY-MM-DD; default: today)
      --skip-validation      Skip XLSForm sheet/column validation
  -h, --help                 Show this help
`,
  );
}

function lstsv2ddiHelp(): void {
  process.stdout.write(
    `${PROG} lstsv2ddi — LimeSurvey structure TSV → DDI-Codebook 2.5 XML

Usage:
  ${PROG} lstsv2ddi <input.tsv> [-o output.xml] [options]

Arguments:
  input.tsv                  Path to a LimeSurvey structure TSV (as produced by xlsform2lstsv)

Options:
  -o, --output <file>        Write XML to <file> (default: stdout)
      --title <text>         Study title (default: TSV surveyls_title, then "Untitled")
      --dataset-filename <n>  Data file URI recorded in <fileDscr> (default: data.csv)
      --prod-date <date>     Override the prodDate (ISO YYYY-MM-DD; default: today)
  -h, --help                 Show this help
`,
  );
}

function lstsv2xlsformHelp(): void {
  process.stdout.write(
    `${PROG} lstsv2xlsform — LimeSurvey structure TSV → XLSForm (JSON)

Usage:
  ${PROG} lstsv2xlsform <input.tsv> [-o output.json] [options]

Arguments:
  input.tsv                  Path to a LimeSurvey structure TSV (as produced by xlsform2lstsv)

Emits { survey, choices, settings } as JSON. Not a full reverse of
xlsform2lstsv — see src/pipelines/lstsv2xlsform/README.md for scope and known lossy fields
(a select's list_name is synthesized; integer/decimal are indistinguishable).

Options:
  -o, --output <file>        Write JSON to <file> (default: stdout)
      --skip-validation      Skip the reverse subset check
  -h, --help                 Show this help
`,
  );
}

function validateHelp(): void {
  process.stdout.write(
    `${PROG} validate — check an XLSForm against the supported XLSForm subset

Usage:
  ${PROG} validate <input.xlsx>

Reports every name/code/type/appearance that falls outside the registry-defined
subset (field names alnum ≤20, answer codes alnum ≤5, registered types only,
allowlisted appearances). Exits non-zero if any errors are found.

Options:
  -h, --help              Show this help
`,
  );
}

// ── Commands ───────────────────────────────────────────────────────────

function cmdValidate(argv: string[]): void {
  const { values, positionals } = parse(argv, {
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return validateHelp();

  const bytes = readInput(positionals, validateHelp);
  // Parse without the built-in strict gate so we can report all findings.
  const data = loadXlsform(bytes, true);
  const violations = XLSValidator.validateSubset(
    data.surveyData,
    data.choicesData,
  );

  if (violations.length === 0) {
    process.stderr.write(`${positionals[0]}: OK — within the XLSForm subset\n`);
    return;
  }

  for (const v of violations) {
    process.stderr.write(
      `  ${v.severity === 'error' ? '✗' : '⚠'} ${v.message}\n`,
    );
  }
  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.length - errors;
  process.stderr.write(`${errors} error(s), ${warnings} warning(s)\n`);
  if (errors > 0) process.exit(1);
}

async function cmdXlsform2lstsv(argv: string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    output: { type: 'string', short: 'o' },
    title: { type: 'string' },
    language: { type: 'string' },
    'no-markdown': { type: 'boolean', default: false },
    'no-welcome-note': { type: 'boolean', default: false },
    'no-end-note': { type: 'boolean', default: false },
    'no-other-pattern': { type: 'boolean', default: false },
    'show-no-answer': { type: 'boolean', default: false },
    'skip-validation': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return xlsform2lstsvHelp();

  const bytes = readInput(positionals, xlsform2lstsvHelp);

  const config: Partial<ConversionConfig> = {
    convertMarkdown: !values['no-markdown'],
    convertWelcomeNote: !values['no-welcome-note'],
    convertEndNote: !values['no-end-note'],
    convertOtherPattern: !values['no-other-pattern'],
    hideNoAnswer: !values['show-no-answer'],
  };
  if (values.language || values.title) {
    config.defaults = {
      language: (values.language as string) ?? 'en',
      groupName: 'Questions',
      surveyTitle: (values.title as string) ?? 'Untitled Survey',
      description: '',
    };
  }

  const data = loadXlsform(bytes, values['skip-validation'] as boolean);

  // Resolve any `select_*_from_file <name>.csv` lists relative to the input
  // workbook's directory (XLSForm convention: the CSV sits beside the form).
  const fileChoices = resolveFileChoices(
    data.surveyData,
    dirname(positionals[0]),
  );

  const converter = new XLSFormToTSVConverter(config);
  let tsv: string;
  try {
    tsv = await converter.convert(
      data.surveyData,
      data.choicesData,
      data.settingsData,
      fileChoices,
    );
  } catch (err) {
    die(`conversion failed: ${(err as Error).message}`);
  }

  emit(tsv, values.output as string | undefined);
}

function cmdXlsform2ddi(argv: string[]): void {
  const { values, positionals } = parse(argv, {
    output: { type: 'string', short: 'o' },
    title: { type: 'string' },
    'dataset-filename': { type: 'string' },
    'prod-date': { type: 'string' },
    'skip-validation': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return xlsform2ddiHelp();

  const bytes = readInput(positionals, xlsform2ddiHelp);
  const data = loadXlsform(bytes, values['skip-validation'] as boolean);

  let xml: string;
  try {
    xml = buildDdiXml(data.surveyData, data.choicesData, {
      assetName: values.title as string | undefined,
      settings: data.settingsData[0],
      datasetFilename: values['dataset-filename'] as string | undefined,
      prodDate: values['prod-date'] as string | undefined,
    });
  } catch (err) {
    return die(`conversion failed: ${(err as Error).message}`);
  }

  emit(xml, values.output as string | undefined);
}

function cmdLstsv2ddi(argv: string[]): void {
  const { values, positionals } = parse(argv, {
    output: { type: 'string', short: 'o' },
    title: { type: 'string' },
    'dataset-filename': { type: 'string' },
    'prod-date': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return lstsv2ddiHelp();

  const bytes = readInput(positionals, lstsv2ddiHelp);

  let xml: string;
  try {
    xml = lstsvToDdiXml(bytes.toString('utf-8'), {
      assetName: values.title as string | undefined,
      datasetFilename: values['dataset-filename'] as string | undefined,
      prodDate: values['prod-date'] as string | undefined,
    });
  } catch (err) {
    return die(`conversion failed: ${(err as Error).message}`);
  }

  emit(xml, values.output as string | undefined);
}

function cmdLstsv2xlsform(argv: string[]): void {
  const { values, positionals } = parse(argv, {
    output: { type: 'string', short: 'o' },
    'skip-validation': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return lstsv2xlsformHelp();

  const bytes = readInput(positionals, lstsv2xlsformHelp);

  let json: string;
  try {
    const xlsform = lstsvToXlsform(bytes.toString('utf-8'), {
      skipValidation: values['skip-validation'] as boolean,
    });
    json = JSON.stringify(xlsform, null, 2) + '\n';
  } catch (err) {
    return die(`conversion failed: ${(err as Error).message}`);
  }

  emit(json, values.output as string | undefined);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '-h' || command === '--help') {
    topHelp();
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case 'validate':
      cmdValidate(rest);
      break;
    case 'xlsform2lstsv':
      await cmdXlsform2lstsv(rest);
      break;
    case 'xlsform2ddi':
      cmdXlsform2ddi(rest);
      break;
    case 'lstsv2ddi':
      cmdLstsv2ddi(rest);
      break;
    case 'lstsv2xlsform':
      cmdLstsv2xlsform(rest);
      break;
    default:
      topHelp();
      die(`unknown command: ${command}`);
  }
}

main().catch((err) => die((err as Error).message));
