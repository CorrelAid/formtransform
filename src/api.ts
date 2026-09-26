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
import { ConversionError } from './diagnostics.js';
import type { WarningHandler } from './diagnostics.js';
import { XLSLoader } from './xlsform/loader.js';
import { XLSValidator } from './xlsform/validate.js';
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
  /** Receives non-fatal findings while loading `.xlsx` bytes. */
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
  options: { onWarning?: WarningHandler; skipValidation?: boolean },
) {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return XLSLoader.parseXLSData(source, options);
  }
  return { ...source, settingsData: source.settingsData ?? [] };
}

/** XLSForm → LimeSurvey structure TSV. */
export async function xlsformToLstsv(
  source: XlsformSource,
  options: XlsformToLstsvOptions = {},
): Promise<string> {
  const { fileChoices, skipValidation, ...config } = options;
  // The loader's checks are LimeSurvey's name gate.
  const form = load(source, { onWarning: config.onWarning, skipValidation });
  return new XLSFormToTSVConverter(config).convert(
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
  const { onWarning, skipValidation, ...ddiOptions } = options;
  // The loader's checks are LimeSurvey's; DDI has its own below.
  const form = load(source, { onWarning, skipValidation: true });
  if (!skipValidation) {
    const errors = XLSValidator.validateSubset(
      form.surveyData,
      form.choicesData,
      { target: 'ddi' },
    ).filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      throw new ConversionError(
        'xlsform-outside-subset',
        `XLSForm uses ${errors.length} feature(s) outside the DDI subset:\n  - ` +
          errors.map((e) => e.message).join('\n  - '),
        { details: errors },
      );
    }
  }
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
