/** Note classification: inline (<preQTxt>) vs orphan (<notes>). */
import { describe, test, expect } from 'vitest';

import { classifyNotes } from '../../ddi/notes.js';
import { Variable } from '../../ddi/types.js';

function v(
  partial: Partial<Variable> & { name: string; type: string },
): Variable {
  return {
    label: '',
    group: '',
    groupLabel: '',
    groupAppearance: '',
    listName: '',
    vocab: '',
    choices: [],
    ...partial,
  };
}

describe('classifyNotes', () => {
  test('removes notes from the data-carrying list', () => {
    const c = classifyNotes([
      v({ name: 'n', type: 'note', label: 'Info' }),
      v({ name: 'q', type: 'integer', label: 'Q' }),
    ]);
    expect(c.dataVars.map((x) => x.name)).toEqual(['q']);
  });

  test('attaches a same-group preceding note as inline preQTxt', () => {
    const c = classifyNotes([
      v({ name: 'n', type: 'note', label: 'Read this' }),
      v({ name: 'q', type: 'integer', label: 'Q' }),
    ]);
    expect(c.inlinePreqtxt.q).toBe('Read this');
    expect(c.orphanNotes).toHaveLength(0);
  });

  test('joins consecutive same-group notes with a blank line', () => {
    const c = classifyNotes([
      v({ name: 'n1', type: 'note', label: 'First' }),
      v({ name: 'n2', type: 'note', label: 'Second' }),
      v({ name: 'q', type: 'integer', label: 'Q' }),
    ]);
    expect(c.inlinePreqtxt.q).toBe('First\n\nSecond');
  });

  test('a note whose successor is in another group becomes an orphan', () => {
    const c = classifyNotes([
      v({ name: 'n', type: 'note', label: 'Intro', group: '' }),
      v({ name: 'q', type: 'integer', label: 'Q', group: 'g' }),
    ]);
    expect(c.inlinePreqtxt.q).toBeUndefined();
    expect(c.orphanNotes.map((x) => x.name)).toEqual(['n']);
  });

  test('a trailing note with no successor becomes an orphan', () => {
    const c = classifyNotes([
      v({ name: 'q', type: 'integer', label: 'Q' }),
      v({ name: 'outro', type: 'note', label: 'Thanks' }),
    ]);
    expect(c.orphanNotes.map((x) => x.name)).toEqual(['outro']);
  });

  test('a lone note is an orphan', () => {
    const c = classifyNotes([v({ name: 'n', type: 'note', label: 'Only' })]);
    expect(c.dataVars).toHaveLength(0);
    expect(c.orphanNotes.map((x) => x.name)).toEqual(['n']);
  });
});
