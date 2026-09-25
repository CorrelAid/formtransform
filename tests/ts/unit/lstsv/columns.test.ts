/**
 * #65: the serializer writes only columns in ATTRIBUTE_COLUMNS, so a question
 * attribute the registry introduces must be listed there, or it is dropped.
 */
import { describe, expect, test } from 'vitest';

import { ATTRIBUTE_COLUMNS } from '../../../../src/lstsv/columns.js';
import { TSVGenerator } from '../../../../src/lstsv/serialize.js';
import { TYPE_MAPPINGS } from '../../../../src/generated/TypeMappings.js';
import { EXCLUSIVE_RULE } from '../../../../src/conventions/exclusive.js';

function registryAttributes(): string[] {
  const attrs = new Set<string>([EXCLUSIVE_RULE.limesurveyAttribute]);
  for (const m of Object.values(TYPE_MAPPINGS)) {
    if (m.dateFormat) attrs.add('date_format');
    for (const a of Object.values(m.parameterAttributes ?? {})) attrs.add(a);
    if (m.integerOnly) attrs.add(m.integerOnly.attribute);
  }
  return [...attrs];
}

describe('TSV columns', () => {
  test('every LimeSurvey attribute the registry names is a column', () => {
    const missing = registryAttributes().filter(
      (a) => !(ATTRIBUTE_COLUMNS as readonly string[]).includes(a),
    );
    expect(missing).toEqual([]);
  });

  test('attribute columns appear only when used, in list order', () => {
    const g = new TSVGenerator();
    const base = {
      class: 'Q',
      'type/scale': 'M',
      name: 'q',
      relevance: '1',
      text: 'Q',
      help: '',
      language: 'en',
      validation: '',
      em_validation_q: '',
      mandatory: '',
      other: '',
      default: '',
      same_default: '',
    };
    g.addRow({ ...base, exclude_all_others: 'none', cssclass: 'x' });
    const header = g.generateTSV().split('\n')[0].split('\t');
    expect(header.slice(-2)).toEqual(['cssclass', 'exclude_all_others']);
    expect(header).not.toContain('date_format');
  });
});
