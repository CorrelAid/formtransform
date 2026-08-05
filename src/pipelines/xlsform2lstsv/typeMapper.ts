/**
 * @file Mapping between XLSForm question types and LimeSurvey question types.
 * @description Backed by the formtransform registry (src/generated/TypeMappings.ts).
 * See https://xlsform.org/en/ref-table/#types and
 * https://www.limesurvey.org/manual/Tab_Separated_Value_survey_structure
 */

export { TYPE_MAPPINGS, TypeMapping } from '../../generated/TypeMappings.js';
import { TYPE_MAPPINGS } from '../../generated/TypeMappings.js';

export interface TypeInfo {
  base: string;
  listName: string | null;
  orOther: boolean;
}

export interface LSType {
  type: string;
  other?: boolean;
  answerClass?: 'A' | 'SQ';
  dateFormat?: string;
}

export class TypeMapper {
  parseType(typeStr: string): TypeInfo {
    const parts = typeStr.split(/\s+/);
    const base = parts[0];

    const mapping = TYPE_MAPPINGS[base];
    let listName: string | null = null;
    let orOther = false;

    if (mapping?.requiresListName) {
      listName = parts[1] || null;
      orOther = parts.includes('or_other');
    }

    return { base, listName, orOther };
  }

  mapType(typeInfo: TypeInfo): LSType {
    const mapping = TYPE_MAPPINGS[typeInfo.base];

    if (!mapping) {
      console.warn(
        `No type mapping found for "${typeInfo.base}", defaulting to text type`,
      );
      return { type: 'S' };
    }

    if (!mapping.limeSurveyType) {
      console.warn(
        `No LimeSurvey type for "${typeInfo.base}", defaulting to text type`,
      );
      return { type: 'S' };
    }

    const result: LSType = { type: mapping.limeSurveyType };

    if (mapping.supportsOther && typeInfo.orOther) {
      result.other = true;
    }

    if (mapping.answerClass) {
      result.answerClass = mapping.answerClass;
    }

    if (mapping.dateFormat) {
      result.dateFormat = mapping.dateFormat;
    }

    return result;
  }
}
