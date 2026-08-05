import { describe, it, expect } from 'vitest';
import { XLSFormToTSVConverter } from '../../../src/index';
import { parseTSV, TSVRow } from '../unit/helpers';

const surveyData = [
  {
    type: 'begin_group',
    name: 'page1',
    label: 'Page One',
    appearance: 'field-list',
  },
  { type: 'text', name: 'name', label: 'Your name' },
  { type: 'integer', name: 'age', label: 'Your age' },
  { type: 'end_group' },
  {
    type: 'begin_group',
    name: 'page2',
    label: 'Page Two',
    appearance: 'field-list',
  },
  { type: 'select_one colors', name: 'favcolor', label: 'Favourite colour' },
  { type: 'note', name: 'thankyou', label: 'Thank you!' },
  { type: 'end_group' },
];

const choicesData = [
  { list_name: 'colors', name: 'red', label: 'Red' },
  { list_name: 'colors', name: 'blue', label: 'Blue' },
  { list_name: 'colors', name: 'green', label: 'Green' },
];

const settingsData = [
  {
    form_title: 'Multi-Page Survey',
    form_id: 'multipage',
    default_language: 'en',
    style: 'pages',
  },
];

async function convertMultiPage(): Promise<TSVRow[]> {
  const converter = new XLSFormToTSVConverter();
  const tsv = await converter.convert(surveyData, choicesData, settingsData);
  return parseTSV(tsv);
}

describe('Integration: multi-page survey (style=pages)', () => {
  it('sets format=G when style=pages', async () => {
    const rows = await convertMultiPage();
    const formatRow = rows.find((r) => r.class === 'S' && r.name === 'format');
    expect(formatRow).toBeDefined();
    expect(formatRow!.text).toBe('G');
  });

  it('creates one group per field-list group', async () => {
    const rows = await convertMultiPage();
    const groups = rows.filter((r) => r.class === 'G');
    const groupNames = groups.map((r) => r.name);
    expect(groupNames).toContain('Page One');
    expect(groupNames).toContain('Page Two');
    expect(groups.length).toBe(2);
  });

  it('questions appear in their respective groups', async () => {
    const rows = await convertMultiPage();
    const gAndQ = rows.filter((r) => r.class === 'G' || r.class === 'Q');
    let currentGroup = '';
    const questionGroup = new Map<string, string>();
    for (const r of gAndQ) {
      if (r.class === 'G') currentGroup = r.name;
      if (r.class === 'Q' && !questionGroup.has(r.name))
        questionGroup.set(r.name, currentGroup);
    }
    expect(questionGroup.get('name')).toBe('Page One');
    expect(questionGroup.get('age')).toBe('Page One');
    expect(questionGroup.get('favcolor')).toBe('Page Two');
    expect(questionGroup.get('thankyou')).toBe('Page Two');
  });

  it('does not set format=G when style is absent', async () => {
    const converter = new XLSFormToTSVConverter();
    const tsv = await converter.convert(surveyData, choicesData, [
      { form_title: 'No Pages', default_language: 'en' },
    ]);
    const rows = parseTSV(tsv);
    const formatRow = rows.find((r) => r.class === 'S' && r.name === 'format');
    expect(formatRow!.text).toBe('A');
  });
});
