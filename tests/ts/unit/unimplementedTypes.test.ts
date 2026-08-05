import { describe, test, expect } from 'vitest';
import { convertAndParse, findRowByName } from './helpers';

describe('Unimplemented XLSForm Types Validation', () => {
  describe('Geo Types', () => {
    test('throws error for unimplemented geopoint type', async () => {
      const survey = [
        { type: 'geopoint', name: 'location', label: 'Location' },
      ];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'geopoint'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented geotrace type', async () => {
      const survey = [{ type: 'geotrace', name: 'path', label: 'Path' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'geotrace'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented geoshape type', async () => {
      const survey = [{ type: 'geoshape', name: 'area', label: 'Area' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'geoshape'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented start-geopoint type', async () => {
      const survey = [
        { type: 'start-geopoint', name: 'start_loc', label: 'Start Location' },
      ];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'start-geopoint'. This type is not registered in the survey type registry.",
      );
    });
  });

  describe('Media Types', () => {
    test('throws error for unimplemented image type', async () => {
      const survey = [{ type: 'image', name: 'photo', label: 'Photo' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'image'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented audio type', async () => {
      const survey = [{ type: 'audio', name: 'recording', label: 'Recording' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'audio'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented video type', async () => {
      const survey = [{ type: 'video', name: 'clip', label: 'Video' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'video'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented file type', async () => {
      const survey = [{ type: 'file', name: 'attachment', label: 'File' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'file'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented barcode type', async () => {
      const survey = [{ type: 'barcode', name: 'code', label: 'Barcode' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'barcode'. This type is not registered in the survey type registry.",
      );
    });
  });

  describe('Other Types', () => {
    test('throws error for unimplemented background-audio type', async () => {
      const survey = [
        {
          type: 'background-audio',
          name: 'bg_audio',
          label: 'Background Audio',
        },
      ];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'background-audio'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented csv-external type', async () => {
      const survey = [
        { type: 'csv-external', name: 'csv_data', label: 'CSV Data' },
      ];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'csv-external'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented phonenumber type', async () => {
      const survey = [{ type: 'phonenumber', name: 'phone', label: 'Phone' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'phonenumber'. This type is not registered in the survey type registry.",
      );
    });

    test('throws error for unimplemented email type', async () => {
      const survey = [{ type: 'email', name: 'email_addr', label: 'Email' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'email'. This type is not registered in the survey type registry.",
      );
    });
  });

  describe('Silently Skipped Types (metadata/record types)', () => {
    test('silently skips start type', async () => {
      const survey = [
        { type: 'start', name: 'start_time', label: 'Start time' },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      const rows = await convertAndParse(survey);
      expect(rows.find((r) => r.name === 'starttime')).toBeUndefined();
      expect(rows.find((r) => r.name === 'q1')).toBeDefined();
    });

    test('silently skips end type', async () => {
      const survey = [
        { type: 'end', name: 'end_time', label: 'End time' },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      const rows = await convertAndParse(survey);
      expect(rows.find((r) => r.name === 'endtime')).toBeUndefined();
      expect(rows.find((r) => r.name === 'q1')).toBeDefined();
    });

    test('silently skips today type', async () => {
      const survey = [
        { type: 'today', name: 'today_date', label: 'Today date' },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      const rows = await convertAndParse(survey);
      expect(rows.find((r) => r.name === 'todaydate')).toBeUndefined();
    });

    test('silently skips deviceid type', async () => {
      const survey = [
        { type: 'deviceid', name: 'device_id', label: 'Device ID' },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      const rows = await convertAndParse(survey);
      expect(rows.find((r) => r.name === 'deviceid')).toBeUndefined();
    });

    test('silently skips username type', async () => {
      const survey = [
        { type: 'username', name: 'user_name', label: 'Username' },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      const rows = await convertAndParse(survey);
      expect(rows.find((r) => r.name === 'username')).toBeUndefined();
    });

    test('silently skips audit type', async () => {
      const survey = [
        { type: 'audit', name: 'audit_q', label: 'Audit Question' },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      const rows = await convertAndParse(survey);
      expect(rows.find((r) => r.name === 'auditq')).toBeUndefined();
    });

    test('throws error for unregistered calculate type', async () => {
      const survey = [
        { type: 'calculate', name: 'calc_q', calculation: '${a} + ${b}' },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'calculate'. This type is not registered in the survey type registry.",
      );
    });

    test('silently skips hidden type', async () => {
      const survey = [
        {
          type: 'hidden',
          name: 'hidden_q',
          label: 'Hidden Field',
          calculation: 'uuid()',
        },
        { type: 'text', name: 'q1', label: 'Question 1' },
      ];

      const rows = await convertAndParse(survey);
      expect(rows.find((r) => r.name === 'hiddenq')).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('throws error for unknown type (registry allowlist)', async () => {
      const survey = [{ type: 'unknown_type', name: 'q1', label: 'Question' }];

      await expect(() => convertAndParse(survey)).rejects.toThrow(
        "Unimplemented XLSForm type: 'unknown_type'. This type is not registered in the survey type registry.",
      );
    });
  });
});
