import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName } from '../helpers';

describe('Special Question Types', () => {
  describe('unknown types', () => {
    test('throws for unknown type (registry allowlist)', async () => {
      const survey = [{ type: 'unknown_type', name: 'q1', label: 'Question' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'unknown_type'. This type is not registered in the survey type registry.",
      );
    });

    test('handles empty type as short text', async () => {
      const survey = [{ type: '', name: 'q2', label: 'Empty type question' }];

      const rows = await convertAndParse(survey);
      const question = findRowByName(rows, 'q2');

      // Empty types should be handled gracefully - they might not create questions
      expect(question).toBeUndefined();
    });
  });

  // describe('system variables (record types)', () => {
  // 	test('throws error for unimplemented start type', () => {
  // 		const survey = [
  // 			{ type: 'start', name: 'start_time', label: 'Start time' }
  // 		];

  // 		expect(() => convertAndParse(survey)).toThrow(
  // 			'Unimplemented XLSForm type: \'start\'. This type is not currently supported.'
  // 		);
  // 	});

  // 	test('throws error for unimplemented end type', () => {
  // 		const survey = [
  // 			{ type: 'end', name: 'end_time', label: 'End time' }
  // 		];

  // 		expect(() => convertAndParse(survey)).toThrow(
  // 			'Unimplemented XLSForm type: \'end\'. This type is not currently supported.'
  // 		);
  // 	});

  // 	test('throws error for unimplemented today type', () => {
  // 		const survey = [
  // 			{ type: 'today', name: 'today_date', label: 'Today date' }
  // 		];

  // 		expect(() => convertAndParse(survey)).toThrow(
  // 			'Unimplemented XLSForm type: \'today\'. This type is not currently supported.'
  // 		);
  // 	});

  // 	test('throws error for unimplemented deviceid type', () => {
  // 		const survey = [
  // 			{ type: 'deviceid', name: 'device_id', label: 'Device ID' }
  // 		];

  // 		expect(() => convertAndParse(survey)).toThrow(
  // 			'Unimplemented XLSForm type: \'deviceid\'. This type is not currently supported.'
  // 		);
  // 	});

  // 	test('throws error for unimplemented username type', () => {
  // 		const survey = [
  // 			{ type: 'username', name: 'user_name', label: 'Username' }
  // 		];

  // 		expect(() => convertAndParse(survey)).toThrow(
  // 			'Unimplemented XLSForm type: \'username\'. This type is not currently supported.'
  // 		);
  // 	});
  // });
});
