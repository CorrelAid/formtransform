/**
 * Registry-driven "allowed XLSForm subset" validator: reports (not throws)
 * every name/code/type/appearance outside the supported subset.
 */
import { describe, test, expect } from 'vitest';

import { XLSValidator } from '../../../src/xlsform/validate.js';

describe('validateSubset', () => {
  test('a legal form has no violations', () => {
    expect(
      XLSValidator.validateSubset(
        [
          { type: 'text', name: 'firstname' },
          { type: 'select_one colors', name: 'fav' },
        ],
        [{ list_name: 'colors', name: 'red', label: 'Red' }],
      ),
    ).toEqual([]);
  });

  test('flags an unregistered type as an error', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'geopoint', name: 'r' }],
      [],
    );
    expect(v).toContainEqual(expect.objectContaining({ severity: 'error' }));
    expect(v[0].message).toMatch(/geopoint.*not in the registry/);
  });

  test('flags an illegal name/code as an error', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'select_one c', name: 'q' }],
      [{ list_name: 'c', name: 'toolong' }],
    );
    expect(
      v.some((x) => x.severity === 'error' && /toolong/.test(x.message)),
    ).toBe(true);
  });

  test('flags an unknown appearance as a warning, not an error', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'text', name: 'q', appearance: 'bogus' }],
      [],
    );
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe('warning');
    expect(v[0].message).toMatch(/bogus/);
  });

  test('accepts select_*_from_file (registered, inlined at convert time)', () => {
    const v = XLSValidator.validateSubset(
      [{ type: 'select_one_from_file iso_3166_1.csv', name: 'country' }],
      [],
    );
    expect(v).toEqual([]);
  });

  test('ignores structural and metadata rows', () => {
    expect(
      XLSValidator.validateSubset(
        [
          { type: 'begin_group', name: 'grp' },
          { type: 'today', name: 'today' },
          { type: 'end_group' },
        ],
        [],
      ),
    ).toEqual([]);
  });
});
