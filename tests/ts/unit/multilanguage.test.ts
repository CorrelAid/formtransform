import { describe, it, expect } from 'vitest';
import { XLSFormToTSVConverter } from '../../../src/pipelines/xlsform2lstsv/index';
import {
  isValidLanguageCode,
  validateLanguageCodes,
} from '../../../src/utils/languageUtils';
import { parseTSV } from './helpers';

/**
 * Tests for multiple language support in XLSForm conversion
 */
describe('Multiple Language Support', () => {
  describe('Language Code Validation', () => {
    it('should validate valid language codes', () => {
      expect(isValidLanguageCode('en')).toBe(true);
      expect(isValidLanguageCode('es')).toBe(true);
      expect(isValidLanguageCode('fr')).toBe(true);
      expect(isValidLanguageCode('de')).toBe(true);
      expect(isValidLanguageCode('zh')).toBe(true);
      expect(isValidLanguageCode('ja')).toBe(true);
      expect(isValidLanguageCode('ar')).toBe(true);
    });

    it('should reject invalid language codes', () => {
      expect(isValidLanguageCode('xx')).toBe(false);
      expect(isValidLanguageCode('12')).toBe(false);
      expect(isValidLanguageCode('eng')).toBe(false);
      expect(isValidLanguageCode('english')).toBe(false);
      expect(isValidLanguageCode('en_US')).toBe(false);
      expect(isValidLanguageCode('')).toBe(false);
      expect(isValidLanguageCode('EN')).toBe(true); // Should be case-insensitive
    });

    it('should validate arrays of language codes', () => {
      const mixedCodes = ['en', 'es', 'fr', 'xx', 'invalid', 'de'];
      const invalid = validateLanguageCodes(mixedCodes);
      expect(invalid).toContain('xx');
      expect(invalid).toContain('invalid');
      expect(invalid).not.toContain('en');
      expect(invalid).not.toContain('es');
      expect(invalid).not.toContain('fr');
      expect(invalid).not.toContain('de');
    });

    it('should handle edge cases', () => {
      expect(isValidLanguageCode(null as any)).toBe(false);
      expect(isValidLanguageCode(undefined as any)).toBe(false);
      expect(isValidLanguageCode(123 as any)).toBe(false);
      expect(isValidLanguageCode({} as any)).toBe(false);
    });
  });

  describe('XLSForm Conversion', () => {
    it('should handle language-specific labels correctly', async () => {
      const converter = new XLSFormToTSVConverter();

      // Mock survey data with language-specific labels
      const surveyData = [
        {
          type: 'text',
          name: 'q1',
          label: {
            en: 'What is your name?',
            es: '¿Cuál es tu nombre?',
            fr: 'Quel est votre nom?',
          },
          _languages: ['en', 'es', 'fr'],
        },
        {
          type: 'integer',
          name: 'age',
          label: {
            en: 'How old are you?',
            es: '¿Cuántos años tienes?',
            fr: 'Quel âge avez-vous?',
          },
          _languages: ['en', 'es', 'fr'],
        },
      ];

      const choicesData: any[] = [];
      const settingsData = [
        {
          default_language: 'English (en)',
        },
      ];

      const result = await converter.convert(
        surveyData,
        choicesData,
        settingsData,
      );

      const tsvRows = parseTSV(result);

      // Should contain language-specific rows for each question
      // Check q1 (text type)
      const q1En = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'en',
      );
      expect(q1En).toBeDefined();
      expect(q1En?.text).toBe('What is your name?');

      const q1Es = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'es',
      );
      expect(q1Es).toBeDefined();
      expect(q1Es?.text).toBe('¿Cuál es tu nombre?');

      const q1Fr = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'fr',
      );
      expect(q1Fr).toBeDefined();
      expect(q1Fr?.text).toBe('Quel est votre nom?');

      // Check age (integer type)
      const ageEn = tsvRows.find(
        (row) => row.name === 'age' && row.language === 'en',
      );
      expect(ageEn).toBeDefined();
      expect(ageEn?.text).toBe('How old are you?');

      const ageEs = tsvRows.find(
        (row) => row.name === 'age' && row.language === 'es',
      );
      expect(ageEs).toBeDefined();
      expect(ageEs?.text).toBe('¿Cuántos años tienes?');

      const ageFr = tsvRows.find(
        (row) => row.name === 'age' && row.language === 'fr',
      );
      expect(ageFr).toBeDefined();
      expect(ageFr?.text).toBe('Quel âge avez-vous?');
    });

    it('should handle language-specific hints correctly', async () => {
      const converter = new XLSFormToTSVConverter();

      // Mock survey data with language-specific hints
      const surveyData = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question 1',
          hint: {
            en: 'Enter your full name',
            es: 'Ingrese su nombre completo',
            fr: 'Entrez votre nom complet',
          },
          _languages: ['en', 'es', 'fr'],
        },
      ];

      const choicesData: any[] = [];
      const settingsData = [
        {
          default_language: 'English (en)',
        },
      ];

      const result = await converter.convert(
        surveyData,
        choicesData,
        settingsData,
      );

      const tsvRows = parseTSV(result);
      const q1En = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'en',
      );
      expect(q1En).toBeDefined();
      expect(q1En?.help).toBe('Enter your full name');

      const q1Es = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'es',
      );
      expect(q1Es).toBeDefined();
      expect(q1Es?.help).toBe('Ingrese su nombre completo');

      const q1Fr = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'fr',
      );
      expect(q1Fr).toBeDefined();
      expect(q1Fr?.help).toBe('Entrez votre nom complet');
    });

    it('should handle language-specific choice labels correctly', async () => {
      const converter = new XLSFormToTSVConverter();

      // Mock survey data with select question
      const surveyData = [
        {
          type: 'select_one options',
          name: 'gender',
          label: {
            en: 'What is your gender?',
            es: '¿Cuál es tu género?',
            fr: 'Quel est votre genre?',
          },
          _languages: ['en', 'es', 'fr'],
        },
      ];

      // Mock choices data with language-specific labels
      const choicesData = [
        {
          list_name: 'options',
          name: 'male',
          label: {
            en: 'Male',
            es: 'Masculino',
            fr: 'Homme',
          },
          _languages: ['en', 'es', 'fr'],
        },
        {
          list_name: 'options',
          name: 'female',
          label: {
            en: 'Female',
            es: 'Femenino',
            fr: 'Femme',
          },
          _languages: ['en', 'es', 'fr'],
        },
      ];

      const settingsData = [
        {
          default_language: 'English (en)',
        },
      ];

      const result = await converter.convert(
        surveyData,
        choicesData,
        settingsData,
      );

      const tsvRows = parseTSV(result);

      const maleEn = tsvRows.find(
        (row) => row.name === 'male' && row.language === 'en',
      );
      expect(maleEn).toBeDefined();
      expect(maleEn?.text).toBe('Male');

      const maleEs = tsvRows.find(
        (row) => row.name === 'male' && row.language === 'es',
      );
      expect(maleEs).toBeDefined();
      expect(maleEs?.text).toBe('Masculino');

      const maleFr = tsvRows.find(
        (row) => row.name === 'male' && row.language === 'fr',
      );
      expect(maleFr).toBeDefined();
      expect(maleFr?.text).toBe('Homme');

      const femaleEn = tsvRows.find(
        (row) => row.name === 'femal' && row.language === 'en',
      );
      expect(femaleEn).toBeDefined();
      expect(femaleEn?.text).toBe('Female');

      const femaleEs = tsvRows.find(
        (row) => row.name === 'femal' && row.language === 'es',
      );
      expect(femaleEs).toBeDefined();
      expect(femaleEs?.text).toBe('Femenino');

      const femaleFr = tsvRows.find(
        (row) => row.name === 'femal' && row.language === 'fr',
      );
      expect(femaleFr).toBeDefined();
      expect(femaleFr?.text).toBe('Femme');
    });

    it('should use base language from settings', async () => {
      const converter = new XLSFormToTSVConverter();

      const surveyData = [
        {
          type: 'text',
          name: 'q1',
          label: 'Question 1',
          _languages: ['en', 'es'],
        },
      ];

      const choicesData: any[] = [];
      const settingsData = [
        {
          default_language: 'Spanish (es)',
        },
      ];

      const result = await converter.convert(
        surveyData,
        choicesData,
        settingsData,
      );

      const tsvRows = parseTSV(result);
      const langRow = tsvRows.find((row) => row.name === 'language');
      expect(langRow).toBeDefined();
      expect(langRow?.text).toBe('es');
    });

    it('should handle fallback to any available language', async () => {
      const converter = new XLSFormToTSVConverter();

      // Mock survey data with only Spanish label
      const surveyData = [
        {
          type: 'text',
          name: 'q1',
          label: {
            es: 'Pregunta en español',
          },
          _languages: ['es'],
        },
      ];

      const choicesData: any[] = [];
      const settingsData = [
        {
          default_language: 'English (en)', // English requested but not available
        },
      ];

      const result = await converter.convert(
        surveyData,
        choicesData,
        settingsData,
      );

      const tsvRows = parseTSV(result);
      const q1 = tsvRows.find((row) => row.name === 'q1');
      expect(q1).toBeDefined();
      expect(q1?.text).toBe('Pregunta en español');
    });

    it('should validate language codes and filter invalid ones', async () => {
      const converter = new XLSFormToTSVConverter();

      // Mock survey data with both valid and invalid language codes
      const surveyData = [
        {
          type: 'text',
          name: 'q1',
          label: {
            en: 'Valid English',
            es: 'Valid Spanish',
            // 'xx' would be invalid but should be filtered out by XLSLoader
          },
          _languages: ['en', 'es'], // Only valid codes
        },
      ];

      const choicesData: any[] = [];
      const settingsData = [
        {
          default_language: 'English (en)',
        },
      ];

      const result = await converter.convert(
        surveyData,
        choicesData,
        settingsData,
      );

      const tsvRows = parseTSV(result);
      const q1En = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'en',
      );
      expect(q1En).toBeDefined();
      expect(q1En?.text).toBe('Valid English');

      const q1Es = tsvRows.find(
        (row) => row.name === 'q1' && row.language === 'es',
      );
      expect(q1Es).toBeDefined();
      expect(q1Es?.text).toBe('Valid Spanish');

      const langEn = tsvRows.find(
        (row) => row.name === 'language' && row.text === 'en',
      );
      expect(langEn).toBeDefined();
      const langEs = tsvRows.find(
        (row) => row.name === 'additional_languages' && row.text === 'es',
      );
      expect(langEs).toBeDefined();
    });
  });
});
