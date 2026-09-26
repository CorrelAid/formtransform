/**
 * Main-entry exports kept for one minor release (#66). Each is renamed, or
 * moves to `@correlaid/formtransform/internals`.
 */
import * as internals from './internals.js';

/** @deprecated Use `xlsformToLstsv`. */
export const XLSFormToTSVConverter = internals.XLSFormToTSVConverter;
/** @deprecated Use `xlsformToLstsv`. */
export type XLSFormToTSVConverter = internals.XLSFormToTSVConverter;
/** @deprecated Use `xlsformToLstsv(bytes, config)`. */
export const XLSFormParser = internals.XLSFormParser;
/** @deprecated Use `xlsformToLstsv(bytes, config)`. */
export type XLSFormParser = internals.XLSFormParser;
/** @deprecated Use `xlsformToDdi`. */
export const buildDdiXml = internals.buildDdiXml;
/** @deprecated Use `lstsvToDdi`. */
export const lstsvToDdiXml = internals.lstsvToDdiXml;

/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const convertRelevance = internals.convertRelevance;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const convertConstraint = internals.convertConstraint;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const xpathToLimeSurvey = internals.xpathToLimeSurvey;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const TypeMapper = internals.TypeMapper;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export type TypeMapper = internals.TypeMapper;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export type TypeInfo = internals.TypeInfo;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export type LSType = internals.LSType;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const TSVGenerator = internals.TSVGenerator;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export type TSVGenerator = internals.TSVGenerator;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const buildDdiCodebook = internals.buildDdiCodebook;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const normalizeChoices = internals.normalizeChoices;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const lstsvRowsToXlsform = internals.lstsvRowsToXlsform;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const ConfigManager = internals.ConfigManager;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export type ConfigManager = internals.ConfigManager;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export type ConversionConfig = internals.ConversionConfig;
/** @deprecated Moves to `@correlaid/formtransform/internals`. */
export const resolveConfig = internals.resolveConfig;
