/**
 * Strict name/code validation: XLSForm names/codes that LimeSurvey cannot
 * represent are rejected (not silently sanitized), preserving round-trip
 * fidelity. Bypassable via skipValidation.
 */
import { describe, test, expect } from 'vitest';

import { XLSValidator } from '../../../src/xlsform/validate.js';

describe('validateNamesAndCodes', () => {
  test('accepts LimeSurvey-legal names and codes', () => {
    expect(() =>
      XLSValidator.validateNamesAndCodes(
        [
          { type: 'text', name: 'firstname' },
          { type: 'select_one colors', name: 'fav' },
          { type: 'end_group' },
        ],
        [
          { list_name: 'colors', name: 'red' },
          { list_name: 'colors', name: 'green' },
        ],
      ),
    ).not.toThrow();
  });

  test('rejects underscores in a field name', () => {
    expect(() =>
      XLSValidator.validateNamesAndCodes(
        [{ type: 'text', name: 'first_name' }],
        [],
      ),
    ).toThrow(/first_name/);
  });

  test('rejects a field name over 20 characters', () => {
    expect(() =>
      XLSValidator.validateNamesAndCodes(
        [{ type: 'text', name: 'institutionsvertrauen' }],
        [],
      ),
    ).toThrow(/20-character/);
  });

  test('rejects an answer code over 5 characters', () => {
    expect(() =>
      XLSValidator.validateNamesAndCodes(
        [{ type: 'select_one c', name: 'q' }],
        [{ list_name: 'c', name: 'smartphone' }],
      ),
    ).toThrow(/5-character/);
  });

  test('rejects duplicate field names', () => {
    expect(() =>
      XLSValidator.validateNamesAndCodes(
        [
          { type: 'text', name: 'dup' },
          { type: 'text', name: 'dup' },
        ],
        [],
      ),
    ).toThrow(/more than once/);
  });

  test('collects every offending name/code in one error', () => {
    expect(() =>
      XLSValidator.validateNamesAndCodes(
        [{ type: 'text', name: 'bad_name' }],
        [{ list_name: 'c', name: 'toolongcode' }],
      ),
    ).toThrow(/bad_name[\s\S]*toolongcode/);
  });
});
