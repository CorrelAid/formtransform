import { describe, test, expect, vi } from 'vitest';
import { convertAndParse, findRowByName, createChoices } from './helpers';

describe('Appearance Handling', () => {
  describe('multiline', () => {
    test('text with multiline appearance produces type T (Long free text)', async () => {
      const survey = [
        {
          type: 'text',
          name: 'bio',
          label: 'Tell us about yourself',
          appearance: 'multiline',
        },
      ];
      const rows = await convertAndParse(survey);
      const q = findRowByName(rows, 'bio');
      expect(q).toBeDefined();
      expect(q!['type/scale']).toBe('T');
    });

    test('text without appearance stays type S (Short free text)', async () => {
      const survey = [{ type: 'text', name: 'name', label: 'Your name' }];
      const rows = await convertAndParse(survey);
      const q = findRowByName(rows, 'name');
      expect(q).toBeDefined();
      expect(q!['type/scale']).toBe('S');
    });

    test('multiline on non-text type does not change type', async () => {
      const survey = [
        { type: 'integer', name: 'age', label: 'Age', appearance: 'multiline' },
      ];
      const rows = await convertAndParse(survey);
      const q = findRowByName(rows, 'age');
      expect(q).toBeDefined();
      expect(q!['type/scale']).toBe('N');
    });

    test('multiline combined with other appearances still produces type T', async () => {
      const survey = [
        {
          type: 'text',
          name: 'notes',
          label: 'Notes',
          appearance: 'multiline compact',
        },
      ];
      const rows = await convertAndParse(survey);
      const q = findRowByName(rows, 'notes');
      expect(q).toBeDefined();
      expect(q!['type/scale']).toBe('T');
    });
  });

  describe('likert', () => {
    test('select_one with likert appearance stays type L', async () => {
      const survey = [
        {
          type: 'select_one rating',
          name: 'satisfaction',
          label: 'How satisfied?',
          appearance: 'likert',
        },
      ];
      const choices = createChoices('rating', [
        { name: 'low', label: 'Low' },
        { name: 'mid', label: 'Medium' },
        { name: 'high', label: 'High' },
      ]);
      const rows = await convertAndParse(survey, choices);
      const q = findRowByName(rows, 'satisfaction');
      expect(q).toBeDefined();
      expect(q!['type/scale']).toBe('L');
    });

    test('likert does not trigger a warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const survey = [
        {
          type: 'select_one rating',
          name: 'q1',
          label: 'Rate',
          appearance: 'likert',
        },
      ];
      const choices = createChoices('rating', [
        { name: 'a', label: 'A' },
        { name: 'b', label: 'B' },
      ]);
      await convertAndParse(survey, choices);
      const appearanceWarnings = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('will be ignored'),
      );
      expect(appearanceWarnings).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });

  describe('minimal (dropdown)', () => {
    test('select_one with minimal appearance produces type ! (Dropdown)', async () => {
      const survey = [
        {
          type: 'select_one yn',
          name: 'q1',
          label: 'Yes?',
          appearance: 'minimal',
        },
      ];
      const choices = createChoices('yn', [
        { name: 'yes', label: 'Yes' },
        { name: 'no', label: 'No' },
      ]);
      const rows = await convertAndParse(survey, choices);
      const q = findRowByName(rows, 'q1');
      expect(q).toBeDefined();
      expect(q!['type/scale']).toBe('!');
    });

    test('minimal does not trigger a warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const survey = [
        {
          type: 'select_one yn',
          name: 'q1',
          label: 'Yes?',
          appearance: 'minimal',
        },
      ];
      const choices = createChoices('yn', [
        { name: 'yes', label: 'Yes' },
        { name: 'no', label: 'No' },
      ]);
      await convertAndParse(survey, choices);
      const appearanceWarnings = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('will be ignored'),
      );
      expect(appearanceWarnings).toHaveLength(0);
      warnSpy.mockRestore();
    });

    test('minimal on non-select_one type does not change type', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const survey = [
        { type: 'text', name: 'q1', label: 'Name', appearance: 'minimal' },
      ];
      await convertAndParse(survey);
      const appearanceWarnings = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('appearance "minimal"'),
      );
      expect(appearanceWarnings).toHaveLength(1);
      warnSpy.mockRestore();
    });
  });

  describe('unsupported appearances', () => {
    test('minimal with other unsupported appearance warns only for unsupported part', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const survey = [
        {
          type: 'select_one yn',
          name: 'q1',
          label: 'Pick',
          appearance: 'minimal horizontal',
        },
      ];
      const choices = createChoices('yn', [
        { name: 'a', label: 'A' },
        { name: 'b', label: 'B' },
      ]);
      await convertAndParse(survey, choices);
      const appearanceWarnings = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('will be ignored'),
      );
      expect(appearanceWarnings).toHaveLength(1);
      expect(appearanceWarnings[0][0]).toContain('"horizontal"');
      warnSpy.mockRestore();
    });

    test('multiline with unsupported appearance warns only for unsupported part', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Notes',
          appearance: 'multiline compact',
        },
      ];
      await convertAndParse(survey);
      const appearanceWarnings = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('will be ignored'),
      );
      expect(appearanceWarnings).toHaveLength(1);
      expect(appearanceWarnings[0][0]).toContain('"compact"');
      warnSpy.mockRestore();
    });

    test('no warning for questions without appearance', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const survey = [{ type: 'text', name: 'q1', label: 'Name' }];
      await convertAndParse(survey);
      const appearanceWarnings = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('will be ignored'),
      );
      expect(appearanceWarnings).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });
});
