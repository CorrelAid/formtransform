/**
 * Helpers shared by the CLI entry (`cli.ts`) and its command modules
 * (`remote/*Command.ts`): argument parsing, exit-on-error, file I/O, and the
 * XLSForm → DDI XML + data CSV step. Node-only; never imported by `src/index`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs, ParseArgsConfig } from 'node:util';

import { XLSFormData } from './config/types.js';
import type { BuildDdiOptions } from './ddi/codebook.js';
import {
  buildDataCsv,
  buildDdiXml,
  choicesByListFromRows,
  extractVariables,
} from './pipelines/xlsform2ddi/index.js';
import type { Submission } from './pipelines/xlsform2ddi/index.js';
import { parseResponses } from './responseFile.js';
import { XLSLoader } from './xlsform/loader.js';

export const PROG = 'formtransform';

export function die(msg: string): never {
  process.stderr.write(`${PROG}: ${msg}\n`);
  process.exit(1);
}

export type ParsedValues = Record<string, string | boolean | undefined>;

/** Parse argv against a spec, exiting with a clean message on failure. */
export function parse(
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
export function readInput(positionals: string[], usage: () => void): Buffer {
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
export function loadXlsform(
  bytes: Buffer,
  skipValidation: boolean,
): XLSFormData {
  try {
    return XLSLoader.parseXLSData(bytes, { skipValidation });
  } catch (err) {
    return die(`failed to parse XLSForm: ${(err as Error).message}`);
  }
}

/** Write to a file (with a stderr notice) or to stdout. */
export function emit(content: string, output: string | undefined): void {
  if (output) {
    writeFileSync(output, content, 'utf-8');
    process.stderr.write(`Wrote ${output}\n`);
  } else {
    process.stdout.write(content);
  }
}

/** Read and parse a `--data` response file, exiting cleanly on failure. */
export function readResponses(path: string): Submission[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return die(`cannot read data file: ${path}`);
  }
  try {
    return parseResponses(text, path);
  } catch (err) {
    return die(`failed to parse data file ${path}: ${(err as Error).message}`);
  }
}

/**
 * Emit the DDI XML for a parsed XLSForm and, when `submissions` are given, the
 * matching data CSV. Throws on conversion errors; callers decide how to exit.
 */
export function xlsformToDdi(
  data: XLSFormData,
  submissions: Submission[] | undefined,
  options: Omit<BuildDdiOptions, 'settings' | 'submissions'>,
): { xml: string; csv?: string } {
  const xml = buildDdiXml(data.surveyData, data.choicesData, {
    ...options,
    settings: data.settingsData[0],
    submissions,
  });
  if (!submissions) return { xml };
  const variables = extractVariables(
    data.surveyData,
    choicesByListFromRows(data.choicesData),
  );
  return { xml, csv: buildDataCsv(variables, submissions) };
}
