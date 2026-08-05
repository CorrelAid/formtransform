import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName, findRowsByClass } from './helpers';

describe('Hint Functionality', () => {
  describe('Basic Hint Support', () => {
    test('converts question with simple hint', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'What is your name?',
          hint: 'Please enter your full name',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question).toBeDefined();
      expect(question?.help).toBe('Please enter your full name');
    });

    test('handles question without hint', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'What is your name?',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question).toBeDefined();
      expect(question?.help).toBe('');
    });

    test('handles empty hint string', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'What is your name?',
          hint: '',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question).toBeDefined();
      expect(question?.help).toBe('');
    });
  });

  describe('Hint Support Across Question Types', () => {
    test('converts text question with hint', async () => {
      const survey = [
        {
          type: 'text',
          name: 'name',
          label: 'Full Name',
          hint: 'Enter your first and last name',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'name');

      expect(question?.help).toBe('Enter your first and last name');
    });

    test('converts integer question with hint', async () => {
      const survey = [
        {
          type: 'integer',
          name: 'age',
          label: 'Age',
          hint: 'Enter your age in years',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'age');

      expect(question?.help).toBe('Enter your age in years');
    });

    test('converts decimal question with hint', async () => {
      const survey = [
        {
          type: 'decimal',
          name: 'height',
          label: 'Height in meters',
          hint: 'Enter as decimal (e.g., 1.75)',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'height');

      expect(question?.help).toBe('Enter as decimal (e.g., 1.75)');
    });

    test('converts date question with hint', async () => {
      const survey = [
        {
          type: 'date',
          name: 'birthdate',
          label: 'Date of Birth',
          hint: 'Format: YYYY-MM-DD',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'birthdate');

      expect(question?.help).toBe('Format: YYYY-MM-DD');
    });

    test('converts time question with hint', async () => {
      const survey = [
        {
          type: 'time',
          name: 'appointment',
          label: 'Appointment Time',
          hint: 'Format: HH:MM:SS',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'appointment');

      expect(question?.help).toBe('Format: HH:MM:SS');
    });

    test('converts date question with hint', async () => {
      const survey = [
        {
          type: 'date',
          name: 'meeting',
          label: 'Meeting Date',
          hint: 'Format: YYYY-MM-DD',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'meeting');

      expect(question?.help).toBe('Format: YYYY-MM-DD');
    });

    test('converts select_one question with hint', async () => {
      const survey = [
        {
          type: 'select_one gender',
          name: 'gender',
          label: 'Gender',
          hint: 'Select your gender',
        },
      ];

      const choices = [
        { list_name: 'gender', name: 'male', label: 'Male' },
        { list_name: 'gender', name: 'female', label: 'Female' },
        { list_name: 'gender', name: 'other', label: 'Other' },
      ];

      const rows = await convertAndParse(survey, choices);
      const question = findRowByName(rows, 'gender');

      expect(question?.help).toBe('Select your gender');
    });

    test('converts select_multiple question with hint', async () => {
      const survey = [
        {
          type: 'select_multiple interests',
          name: 'interests',
          label: 'Interests',
          hint: 'Select all that apply',
        },
      ];

      const choices = [
        { list_name: 'interests', name: 'sports', label: 'Sports' },
        { list_name: 'interests', name: 'music', label: 'Music' },
        { list_name: 'interests', name: 'reading', label: 'Reading' },
      ];

      const rows = await convertAndParse(survey, choices);
      const question = findRowByName(rows, 'interests');

      expect(question?.help).toBe('Select all that apply');
    });

    test('converts note with hint', async () => {
      const survey = [
        {
          type: 'note',
          name: 'info',
          label: 'Important Information',
          hint: 'Additional help text',
        },
      ];

      const rows = await convertAndParse(survey);
      const note = findRowByName(rows, 'info');

      expect(note?.help).toBe('Additional help text');
    });
  });

  describe('Group Hints', () => {
    test('converts group with hint', async () => {
      const survey = [
        {
          type: 'begin_group',
          name: 'personal',
          label: 'Personal Information',
          hint: 'Please provide your personal details',
        },
        { type: 'text', name: 'name', label: 'Name' },
        { type: 'end_group' },
      ];

      const rows = await convertAndParse(survey);
      const groupRows = findRowsByClass(rows, 'G');
      const personalGroup = groupRows.find(
        (r) => r.name === 'Personal Information',
      );

      expect(personalGroup).toBeDefined();
      // For groups, hint goes into text (description) column
      expect(personalGroup?.text).toBe('Please provide your personal details');
    });

    test('handles group without hint', async () => {
      const survey = [
        {
          type: 'begin_group',
          name: 'personal',
          label: 'Personal Information',
        },
        { type: 'text', name: 'name', label: 'Name' },
        { type: 'end_group' },
      ];

      const rows = await convertAndParse(survey);
      const groupRows = findRowsByClass(rows, 'G');
      const personalGroup = groupRows.find(
        (r) => r.name === 'Personal Information',
      );

      expect(personalGroup).toBeDefined();
      expect(personalGroup?.text).toBe('');
    });
  });

  describe('Multilingual Hints', () => {
    test('converts question with language-specific hints', async () => {
      const survey = [
        {
          type: 'text',
          name: 'name',
          label: {
            en: 'What is your name?',
            es: '¿Cuál es tu nombre?',
          },
          hint: {
            en: 'Enter your full name',
            es: 'Ingresa tu nombre completo',
          },
          _languages: ['en', 'es'],
        },
      ];

      const rows = await convertAndParse(survey);
      const englishQuestion = rows.find(
        (r) => r.name === 'name' && r.language === 'en',
      );
      const spanishQuestion = rows.find(
        (r) => r.name === 'name' && r.language === 'es',
      );

      expect(englishQuestion?.help).toBe('Enter your full name');
      expect(spanishQuestion?.help).toBe('Ingresa tu nombre completo');
    });

    test('converts group with language-specific hints', async () => {
      const survey = [
        {
          type: 'begin_group',
          name: 'demo',
          label: {
            en: 'Demographic Information',
            es: 'Información Demográfica',
          },
          hint: {
            en: 'Please provide demographic information',
            es: 'Por favor proporcione información demográfica',
          },
          _languages: ['en', 'es'],
        },
        { type: 'text', name: 'age', label: 'Age' },
        { type: 'end_group' },
      ];

      const rows = await convertAndParse(survey);
      const groupRows = findRowsByClass(rows, 'G');
      // Group name is the label
      const englishGroup = groupRows.find(
        (r) => r.name === 'Demographic Information' && r.language === 'en',
      );
      const spanishGroup = groupRows.find(
        (r) => r.name === 'Información Demográfica' && r.language === 'es',
      );

      // For groups, hint goes into text (description) column
      expect(englishGroup?.text).toBe('Please provide demographic information');
      expect(spanishGroup?.text).toBe(
        'Por favor proporcione información demográfica',
      );
    });

    test('handles missing hint in one language', async () => {
      const survey = [
        {
          type: 'text',
          name: 'name',
          label: {
            en: 'What is your name?',
            es: '¿Cuál es tu nombre?',
          },
          hint: {
            en: 'Enter your full name',
            // Spanish hint is missing
          },
          _languages: ['en', 'es'],
        },
      ];

      const rows = await convertAndParse(survey);
      const englishQuestion = rows.find(
        (r) => r.name === 'name' && r.language === 'en',
      );
      const spanishQuestion = rows.find(
        (r) => r.name === 'name' && r.language === 'es',
      );

      expect(englishQuestion?.help).toBe('Enter your full name');
      // When Spanish hint is missing, the current implementation falls back to English hint
      expect(spanishQuestion?.help).toBe('Enter your full name');
    });
  });

  describe('Hint Edge Cases', () => {
    test('handles very long hint text', async () => {
      const longHint =
        'This is a very long hint text that contains a lot of information and guidance for the user. ' +
        'It should be preserved exactly as provided without truncation or modification.';

      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question',
          hint: longHint,
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question?.help).toBe(longHint);
    });

    test('handles hint with special characters', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question',
          hint: 'Special chars: <>&"\'NewlineTab',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question?.help).toBe(
        'Special chars: &lt;&gt;&amp;&quot;&#39;NewlineTab',
      );
    });

    test('handles hint with unicode characters', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question',
          hint: 'Unicode: 你好世界 🌍 café naïve',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question?.help).toBe('Unicode: 你好世界 🌍 café naïve');
    });

    test('handles hint with HTML-like content', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question',
          hint: '<b>Bold</b> and <i>italic</i> formatting',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question?.help).toBe('<b>Bold</b> and <i>italic</i> formatting');
    });
  });

  describe('Hint Validation and Error Handling', () => {
    test('handles null hint gracefully', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question',
          hint: null,
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question?.help).toBe('');
    });

    test('handles undefined hint gracefully', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question',
          // hint is undefined
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question?.help).toBe('');
    });

    test('handles hint with only whitespace', async () => {
      const survey = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question',
          hint: '   ',
        },
      ];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q1');

      expect(question?.help).toBe('');
    });
  });
});
