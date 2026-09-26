/**
 * The conversion entry points, one function per direction, named
 * `<source>To<Target>` (#66). Each takes the source as its first argument and
 * an options object second.
 *
 * An XLSForm source is either the file's bytes (`.xlsx`) or an already
 * loaded form (what {@link XLSLoader.parseXLSData} returns); a LimeSurvey
 * source is the structure TSV text.
 */
import type { BuildDdiOptions } from './ddi/index.js';
import type { LstsvConfig } from './config/types.js';
import { ConversionError, consoleWarning } from './diagnostics.js';
import type { WarningHandler } from './diagnostics.js';
import { XLSLoader } from './xlsform/loader.js';
import { XLSValidator } from './xlsform/validate.js';
import type { SubsetTarget } from './xlsform/validate.js';
import type { ChoiceRow, SettingsRow, SurveyRow } from './xlsform/types.js';
import { XLSFormToTSVConverter } from './pipelines/xlsform2lstsv/index.js';
import { buildDdiXml } from './pipelines/xlsform2ddi/index.js';
import { lstsvToDdiXml } from './pipelines/lstsv2ddi/index.js';
import type { LstsvToDdiOptions } from './pipelines/lstsv2ddi/index.js';

/** An XLSForm: the `.xlsx` bytes, or its loaded sheets. */
export type XlsformSource =
  | ArrayBuffer
  | Buffer
  | {
      surveyData: SurveyRow[];
      choicesData: ChoiceRow[];
      settingsData?: SettingsRow[];
    };

interface XlsformSourceOptions {
  /**
   * Choices for `select_*_from_file` CSVs, keyed by filename. Registered
   * vocabularies are built in.
   */
  fileChoices?: Record<string, ChoiceRow[]>;
  /**
   * Receives every non-fatal finding: from loading `.xlsx` bytes, from the
   * subset check, and from the conversion. Default: the console.
   */
  onWarning?: WarningHandler;
  /**
   * Skip the subset check and convert what can be converted. For LimeSurvey,
   * names and codes outside its limits are then sanitized, which loses
   * round-trip fidelity.
   */
  skipValidation?: boolean;
}

export type XlsformToLstsvOptions = Partial<LstsvConfig> & XlsformSourceOptions;

export type XlsformToDdiOptions = BuildDdiOptions &
  Omit<XlsformSourceOptions, 'fileChoices'>;

function load(
  source: XlsformSource,
  options: {
    onWarning?: WarningHandler;
    skipValidation?: boolean;
    skipNameCheck?: boolean;
  },
) {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return XLSLoader.parseXLSData(source, options);
  }
  return { ...source, settingsData: source.settingsData ?? [] };
}

const TARGET_NAMES: Record<SubsetTarget, string> = {
  lstsv: 'LimeSurvey',
  ddi: 'DDI',
};

/**
 * Pass each subset warning to `onWarning`, then throw
 * `xlsform-outside-subset` with every error in `details` if there are any.
 */
function checkSubset(
  form: { surveyData: SurveyRow[]; choicesData: ChoiceRow[] },
  target: SubsetTarget,
  onWarning: WarningHandler,
  fileChoices?: Record<string, ChoiceRow[]>,
): void {
  const found = XLSValidator.validateSubset(form.surveyData, form.choicesData, {
    target,
    fileChoices,
  });
  for (const d of found) if (d.severity === 'warning') onWarning(d);
  const errors = found.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    throw new ConversionError(
      'xlsform-outside-subset',
      `XLSForm uses ${errors.length} feature(s) outside the ${TARGET_NAMES[target]} subset:\n  - ` +
        errors.map((e) => e.message).join('\n  - '),
      { details: errors },
    );
  }
}

/**
 * The caller's handler (default: console), passing each warning once: the
 * subset check and the converter report some findings (e.g. an unregistered
 * appearance) both.
 */
function onceEach(onWarning: WarningHandler = consoleWarning): WarningHandler {
  const seen = new Set<string>();
  return (w) => {
    const key = `${w.code}\0${w.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    onWarning(w);
  };
}

/**
 * XLSForm → LimeSurvey structure TSV. Rejects a form outside the subset
 * (`validateSubset` with `target: 'lstsv'`) unless `skipValidation`; names
 * and codes outside LimeSurvey's limits are then sanitized.
 */
export async function xlsformToLstsv(
  source: XlsformSource,
  options: XlsformToLstsvOptions = {},
): Promise<string> {
  const { fileChoices, skipValidation, ...config } = options;
  const onWarning = onceEach(config.onWarning);
  // The subset check covers the loader's name check and reports every finding.
  const form = load(source, { onWarning, skipValidation, skipNameCheck: true });
  if (!skipValidation) checkSubset(form, 'lstsv', onWarning, fileChoices);
  return new XLSFormToTSVConverter({ ...config, onWarning }).convert(
    form.surveyData,
    form.choicesData,
    form.settingsData,
    fileChoices,
  );
}

/**
 * XLSForm → DDI-Codebook 2.5 XML. The form's settings sheet supplies
 * `settings` unless the options give it. Rejects a form outside the subset
 * (`validateSubset` with `target: 'ddi'`) unless `skipValidation`.
 */
export function xlsformToDdi(
  source: XlsformSource,
  options: XlsformToDdiOptions = {},
): string {
  const { onWarning: handler, skipValidation, ...ddiOptions } = options;
  const onWarning = onceEach(handler);
  // The loader's checks are LimeSurvey's; DDI has its own below.
  const form = load(source, { onWarning, skipValidation: true });
  if (!skipValidation) checkSubset(form, 'ddi', onWarning);
  return buildDdiXml(form.surveyData, form.choicesData, {
    settings: form.settingsData[0],
    ...ddiOptions,
  });
}

/** LimeSurvey structure TSV → DDI-Codebook 2.5 XML. */
export function lstsvToDdi(
  tsv: string,
  options: LstsvToDdiOptions = {},
): string {
  return lstsvToDdiXml(tsv, options);
}
