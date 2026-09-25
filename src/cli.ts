#!/usr/bin/env node
import { basename, dirname, join } from 'node:path';

import { ConversionConfig } from './config/ConfigManager.js';
import { resolveFileChoices } from './fileChoices.js';
import { lstsvToDataCsv, lstsvToDdiXml } from './pipelines/lstsv2ddi/index.js';
import { lstsvToXlsform } from './pipelines/lstsv2xlsform/index.js';
import type { Submission } from './pipelines/xlsform2ddi/index.js';
import { XLSFormToTSVConverter } from './pipelines/xlsform2lstsv/index.js';
import type { XLSFormData } from './config/types.js';
import { XLSValidator } from './xlsform/validate.js';
import type { SubsetTarget } from './xlsform/validate.js';
import {
  PROG,
  die,
  emit,
  loadXlsform,
  parse,
  readInput,
  readResponses,
  xlsformToDdi,
} from './cliShared.js';
import type { ParsedValues } from './cliShared.js';

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
  ${PROG} xlsform2ddi <input.xlsx> [-o output.xml] [--data responses] [options]

Arguments:
  input.xlsx                 Path to the XLSForm workbook (survey/choices/settings sheets)

Options:
  -o, --output <file>        Write XML to <file> (default: stdout)
      --data <file>          Response records (.csv with a header of question names,
                             ; or , delimited — or a Kobo submissions .json array).
                             Sets <caseQnty> and writes the DDI data CSV
      --data-out <file>      Where to write the data CSV (default: <dataset-filename>
                             beside the -o file; required when the XML goes to stdout)
      --title <text>         Study title (default: settings form_title, then "Untitled")
      --dataset-filename <n>  Data file URI recorded in <fileDscr> (default: data.csv,
                             or the --data-out file name)
      --prod-date <date>     Override the prodDate (ISO YYYY-MM-DD; default: today)
      --skip-validation      Skip the subset check (types, choice lists, unique
                             names/codes). LimeSurvey's name limits never apply
                             here: DDI keeps names as authored
  -h, --help                 Show this help
`,
  );
}

function lstsv2ddiHelp(): void {
  process.stdout.write(
    `${PROG} lstsv2ddi — LimeSurvey structure TSV → DDI-Codebook 2.5 XML

Usage:
  ${PROG} lstsv2ddi <input.tsv> [-o output.xml] [--data responses] [options]

Arguments:
  input.tsv                  Path to a LimeSurvey structure TSV (as produced by xlsform2lstsv)

Options:
  -o, --output <file>        Write XML to <file> (default: stdout)
      --data <file>          LimeSurvey response export with question-code headings
                             (.csv, ; or , delimited, or a .json array of rows).
                             Sets <caseQnty> and writes the DDI data CSV
      --data-out <file>      Where to write the data CSV (default: <dataset-filename>
                             beside the -o file; required when the XML goes to stdout)
      --title <text>         Study title (default: TSV surveyls_title, then "Untitled")
      --dataset-filename <n>  Data file URI recorded in <fileDscr> (default: data.csv,
                             or the --data-out file name)
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

Reports every name/code/type/appearance/choice-list problem outside the
registry-defined subset. Exits non-zero if any errors are found.

Options:
      --target <t>        lstsv (default): every rule, including LimeSurvey's
                          limits (field names alnum ≤20, answer codes alnum ≤5).
                          ddi: without those limits; DDI keeps names as authored
  -h, --help              Show this help
`,
  );
}

// ── Commands ───────────────────────────────────────────────────────────

/**
 * Check a loaded form against the subset for `target`, with CSVs beside the
 * workbook counting as resolved (as they do for xlsform2lstsv). Prints every
 * finding to stderr and returns the number of errors.
 */
function checkSubset(
  data: XLSFormData,
  inputPath: string,
  target: SubsetTarget,
): number {
  const violations = XLSValidator.validateSubset(
    data.surveyData,
    data.choicesData,
    {
      target,
      fileChoices: resolveFileChoices(data.surveyData, dirname(inputPath)),
    },
  );
  for (const v of violations) {
    process.stderr.write(
      `  ${v.severity === 'error' ? '✗' : '⚠'} ${v.message}\n`,
    );
  }
  return violations.filter((v) => v.severity === 'error').length;
}

function cmdValidate(argv: string[]): void {
  const { values, positionals } = parse(argv, {
    target: { type: 'string', default: 'lstsv' },
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return validateHelp();
  const target = values.target as string;
  if (target !== 'lstsv' && target !== 'ddi') {
    return die(`--target must be "lstsv" or "ddi", got "${target}"`);
  }

  const bytes = readInput(positionals, validateHelp);
  // Parse without the built-in strict gate so we can report all findings.
  const data = loadXlsform(bytes, true);
  const errors = checkSubset(data, positionals[0], target);
  if (errors === 0) {
    process.stderr.write(
      `${positionals[0]}: OK — within the XLSForm subset (${target})\n`,
    );
    return;
  }
  process.stderr.write(`${errors} error(s)\n`);
  process.exit(1);
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

/**
 * Resolve where the data CSV goes and which name `<fileDscr>` records, so the
 * two cannot disagree: an explicit `--data-out` names the file (and, absent
 * `--dataset-filename`, the URI); otherwise the file is the dataset filename
 * placed beside the XML output.
 */
function resolveDataOutput(
  dataOut: string | undefined,
  datasetFilename: string | undefined,
  xmlOutput: string | undefined,
): { path: string; datasetFilename: string } {
  if (dataOut) {
    const name = datasetFilename ?? basename(dataOut);
    if (basename(dataOut) !== basename(name)) {
      process.stderr.write(
        `${PROG}: warning: --data-out ${dataOut} does not match --dataset-filename ${name} recorded in <fileDscr>\n`,
      );
    }
    return { path: dataOut, datasetFilename: name };
  }
  if (!xmlOutput) {
    return die(
      '--data with the XML on stdout needs an explicit --data-out <file>',
    );
  }
  const name = datasetFilename ?? 'data.csv';
  return { path: join(dirname(xmlOutput), name), datasetFilename: name };
}

/** `--data` / `--data-out` option specs shared by the *2ddi commands. */
const DATA_OPTIONS = {
  data: { type: 'string' },
  'data-out': { type: 'string' },
} as const;

/** Resolved `--data` state: parsed rows, CSV path, and the recorded URI. */
interface DataPlan {
  submissions?: Submission[];
  dataOut?: string;
  datasetFilename?: string;
}

/**
 * Read `--data` (if given) and decide where its CSV goes. Call before
 * converting so a bad flag combination fails before any output is written.
 */
function planData(values: ParsedValues): DataPlan {
  const dataPath = values.data as string | undefined;
  const datasetFilename = values['dataset-filename'] as string | undefined;
  if (!dataPath) {
    if (values['data-out']) die('--data-out requires --data');
    return { datasetFilename };
  }
  const resolved = resolveDataOutput(
    values['data-out'] as string | undefined,
    datasetFilename,
    values.output as string | undefined,
  );
  return {
    submissions: readResponses(dataPath),
    dataOut: resolved.path,
    datasetFilename: resolved.datasetFilename,
  };
}

function cmdXlsform2ddi(argv: string[]): void {
  const { values, positionals } = parse(argv, {
    output: { type: 'string', short: 'o' },
    ...DATA_OPTIONS,
    title: { type: 'string' },
    'dataset-filename': { type: 'string' },
    'prod-date': { type: 'string' },
    'skip-validation': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return xlsform2ddiHelp();

  const bytes = readInput(positionals, xlsform2ddiHelp);
  // DDI keeps names as authored, so LimeSurvey's name/code limits don't apply
  // (a Kobo `full_name` is fine); types, lists and uniqueness still do.
  const data = loadXlsform(bytes, true);
  if (!values['skip-validation']) {
    const errors = checkSubset(data, positionals[0], 'ddi');
    if (errors > 0) {
      return die(
        `${errors} error(s): outside the XLSForm subset for DDI (--skip-validation to convert anyway)`,
      );
    }
  }
  const { submissions, dataOut, datasetFilename } = planData(values);

  let xml: string;
  let csv: string | undefined;
  try {
    ({ xml, csv } = xlsformToDdi(data, submissions, {
      assetName: values.title as string | undefined,
      datasetFilename,
      prodDate: values['prod-date'] as string | undefined,
    }));
  } catch (err) {
    return die(`conversion failed: ${(err as Error).message}`);
  }

  emit(xml, values.output as string | undefined);
  if (csv !== undefined && dataOut) emit(csv, dataOut);
}

function cmdLstsv2ddi(argv: string[]): void {
  const { values, positionals } = parse(argv, {
    output: { type: 'string', short: 'o' },
    ...DATA_OPTIONS,
    title: { type: 'string' },
    'dataset-filename': { type: 'string' },
    'prod-date': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  });

  if (values.help) return lstsv2ddiHelp();

  const tsv = readInput(positionals, lstsv2ddiHelp).toString('utf-8');
  const { submissions, dataOut, datasetFilename } = planData(values);

  let xml: string;
  let csv: string | undefined;
  try {
    xml = lstsvToDdiXml(tsv, {
      assetName: values.title as string | undefined,
      datasetFilename,
      prodDate: values['prod-date'] as string | undefined,
      submissions,
    });
    if (submissions) {
      csv = lstsvToDataCsv(tsv, submissions, {
        onWarning: (msg) => process.stderr.write(`${PROG}: warning: ${msg}\n`),
      });
    }
  } catch (err) {
    return die(`conversion failed: ${(err as Error).message}`);
  }

  emit(xml, values.output as string | undefined);
  if (csv !== undefined && dataOut) emit(csv, dataOut);
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
