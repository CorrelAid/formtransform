import { describe, it, expect, beforeAll, vi } from 'vitest';
import { XLSFormParser, XLSLoader, XLSValidator } from '../index';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for XLSFormParser conversion functionality.
 * Focuses on the TSV conversion capabilities of XLSFormParser.
 */
describe('XLSFormParser Conversion', () => {
  let testXlsxPath: string;
  let testXlsxData: Buffer;

  beforeAll(() => {
    // Create a simple test XLSX file
    const testData = [
      ['type', 'name', 'label'],
      ['text', 'q1', 'Question 1'],
      ['integer', 'q2', 'Question 2'],
      ['select_one', 'q3', 'Question 3'],
    ];

    // Create choices sheet
    const choicesData = [
      ['list_name', 'name', 'label'],
      ['options', 'yes', 'Yes'],
      ['options', 'no', 'No'],
    ];

    // Note: In a real implementation, this would create an actual XLSX file
    // For now, we'll use the existing test infrastructure
  });

  // Test that conversion methods are available
  it('should have convertXLSFileToTSV method', () => {
    expect(XLSFormParser.convertXLSFileToTSV).toBeDefined();
    expect(typeof XLSFormParser.convertXLSFileToTSV).toBe('function');
  });

  it('should have convertXLSDataToTSV method', () => {
    expect(XLSFormParser.convertXLSDataToTSV).toBeDefined();
    expect(typeof XLSFormParser.convertXLSDataToTSV).toBe('function');
  });

  // Note: Actual conversion tests would require proper file setup
  // and are covered in the tutorialFile.test.ts
});

/**
 * Tests for XLSLoader with built-in validation.
 * Verifies that loading includes validation by default.
 */
describe('XLSLoader with Validation', () => {
  it('should throw error when required sheets are missing', () => {
    // Create a mock workbook with only survey sheet (missing choices)
    const mockWorkbook: any = {
      SheetNames: ['survey'],
      Sheets: {
        survey: {
          '!ref': 'A1:C2',
          A1: { t: 's', v: 'type' },
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'text' },
          B2: { t: 's', v: 'q1' },
          C2: { t: 's', v: 'Question 1' },
        },
      },
    };

    // Should throw when loading (validation is included by default)
    expect(() => {
      XLSLoader.parseWorkbook(mockWorkbook);
    }).toThrowError(/XLSX file is missing required sheets: choices/);
  });

  it('should throw error when all required sheets are missing', () => {
    // Create a mock workbook with no valid sheets
    const mockWorkbook: any = {
      SheetNames: ['other'],
      Sheets: {
        other: {
          '!ref': 'A1:A1',
          A1: { t: 's', v: 'some_data' },
        },
      },
    };

    // Should throw when loading (validation is included by default)
    expect(() => {
      XLSLoader.parseWorkbook(mockWorkbook);
    }).toThrowError(/XLSX file is missing required sheets: survey, choices/);
  });

  it('should not throw error when all required sheets are present', () => {
    // Create a mock workbook with all required sheets
    const mockWorkbook: any = {
      SheetNames: ['survey', 'choices'],
      Sheets: {
        survey: {
          '!ref': 'A1:C2',
          A1: { t: 's', v: 'type' },
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'text' },
          B2: { t: 's', v: 'q1' },
          C2: { t: 's', v: 'Question 1' },
        },
        choices: {
          '!ref': 'A1:C3',
          A1: { t: 's', v: 'list_name' },
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'options' },
          B2: { t: 's', v: 'yes' },
          C2: { t: 's', v: 'Yes' },
          A3: { t: 's', v: 'options' },
          B3: { t: 's', v: 'no' },
          C3: { t: 's', v: 'No' },
        },
      },
    };

    // Should not throw (validation passes)
    expect(() => {
      XLSLoader.parseWorkbook(mockWorkbook);
    }).not.toThrow();
  });

  it('should throw error when survey sheet is missing required columns', () => {
    // Create a mock workbook with survey sheet missing 'type' column
    const mockWorkbook: any = {
      SheetNames: ['survey', 'choices'],
      Sheets: {
        survey: {
          '!ref': 'A1:B2',
          A1: { t: 's', v: 'name' }, // Missing 'type' column
          B1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'q1' },
          B2: { t: 's', v: 'Question 1' },
        },
        choices: {
          '!ref': 'A1:C2',
          A1: { t: 's', v: 'list_name' },
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'options' },
          B2: { t: 's', v: 'yes' },
          C2: { t: 's', v: 'Yes' },
        },
      },
    };

    // Should throw when loading (validation is included by default)
    expect(() => {
      XLSLoader.parseWorkbook(mockWorkbook);
    }).toThrowError(/Survey sheet "survey" is missing required columns: type/);
  });

  it('should throw error when choices sheet is missing required columns', () => {
    // Create a mock workbook with choices sheet missing 'list_name' column
    const mockWorkbook: any = {
      SheetNames: ['survey', 'choices'],
      Sheets: {
        survey: {
          '!ref': 'A1:C2',
          A1: { t: 's', v: 'type' },
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'text' },
          B2: { t: 's', v: 'q1' },
          C2: { t: 's', v: 'Question 1' },
        },
        choices: {
          '!ref': 'A1:B2',
          A1: { t: 's', v: 'name' }, // Missing 'list_name' column
          B1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'yes' },
          B2: { t: 's', v: 'Yes' },
        },
      },
    };

    // Should throw when loading (validation is included by default)
    expect(() => {
      XLSLoader.parseWorkbook(mockWorkbook);
    }).toThrowError(
      /Choices sheet "choices" is missing required columns: list_name/,
    );
  });

  it('should handle choices sheet with list name (space) instead of list_name (underscore)', () => {
    // Create a mock workbook with 'list name' instead of 'list_name'
    const mockWorkbook: any = {
      SheetNames: ['survey', 'choices'],
      Sheets: {
        survey: {
          '!ref': 'A1:C2',
          A1: { t: 's', v: 'type' },
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'text' },
          B2: { t: 's', v: 'q1' },
          C2: { t: 's', v: 'Question 1' },
        },
        choices: {
          '!ref': 'A1:C2',
          A1: { t: 's', v: 'list name' }, // Space instead of underscore
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'options' },
          B2: { t: 's', v: 'yes' },
          C2: { t: 's', v: 'Yes' },
        },
      },
    };

    // Should not throw (should handle both space and underscore versions)
    expect(() => {
      XLSLoader.parseWorkbook(mockWorkbook);
    }).not.toThrow();
  });

  it('should allow skipping validation when explicitly requested', () => {
    // Create a mock workbook with missing choices sheet
    const mockWorkbook: any = {
      SheetNames: ['survey'],
      Sheets: {
        survey: {
          '!ref': 'A1:C2',
          A1: { t: 's', v: 'type' },
          B1: { t: 's', v: 'name' },
          C1: { t: 's', v: 'label' },
          A2: { t: 's', v: 'text' },
          B2: { t: 's', v: 'q1' },
          C2: { t: 's', v: 'Question 1' },
        },
      },
    };

    // Should not throw when validation is explicitly skipped
    expect(() => {
      XLSLoader.parseWorkbook(mockWorkbook, { skipValidation: true });
    }).not.toThrow();
  });
});
