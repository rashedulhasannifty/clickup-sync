import { StellarCsvError } from './csv';
import {
  mapLeaveStatus,
  mapLeaveType,
  mergeLeaveDays,
  parseStellarLeavesCsv,
  splitUserName,
  type StellarLeaveDay,
} from './stellar-leaves-csv';

/** Fake people only. 2026-07-03 is a Friday, 07-04/05 the weekend. */
const HEADER =
  '"","User Name","Leave Type","Date","Apply Date","Description","Status","Action"';
const row = (...cells: string[]) => cells.map((c) => `"${c}"`).join(',');
const FIXTURE = [
  '﻿' + HEADER,
  // Thu, Fri, Mon: one run across the weekend; apply dates differ by seconds only.
  row('', 'Test Alpha (7)', 'Casual Leave', '2026-07-02 00:00:00', '2026-06-30 10:50:11', 'Family event', 'approved', 'Edit'),
  row('', 'Test Alpha (7)', 'Casual Leave', '2026-07-03 00:00:00', '2026-06-30 10:51:09', 'Family event', 'approved', 'Edit'),
  row('', 'Test Alpha (7)', 'Casual Leave', '2026-07-06 00:00:00', '2026-06-30 10:51:26', 'Family event', 'approved', 'Edit'),
  // A gap (Wed) starts a new record.
  row('', 'Test Alpha (7)', 'Casual Leave', '2026-07-08 00:00:00', '2026-06-30 10:52:00', 'Family event', 'approved', 'Edit'),
  // Different status: never merged with the approved run.
  row('', 'Test Beta (8)', 'Sick Leave', '2026-07-02 00:00:00', '2026-07-02 09:00:00', 'Fever, with ""quotes""', 'rejected', 'Edit'),
  // Weekend day: flagged and skipped.
  row('', 'Test Beta (8)', 'Sick Leave', '2026-07-04 00:00:00', '2026-07-02 09:00:00', '', 'approved', 'Edit'),
  // Unknown type: imported as OTHER, flagged.
  row('', 'Test Gamma (9)', 'Paternity Leave', '2026-07-07 00:00:00', '2026-07-01 09:00:00', '', 'approved', 'Edit'),
  // No id in the name.
  row('', 'Nobody', 'Casual Leave', '2026-07-07 00:00:00', '', '', 'approved', 'Edit'),
].join('\r\n');

describe('splitUserName / mapLeaveType / mapLeaveStatus', () => {
  it('takes the Stellar id from the parentheses', () => {
    expect(splitUserName('Test Alpha (41)')).toEqual({
      name: 'Test Alpha',
      attendanceId: '41',
    });
    expect(splitUserName('Plain')).toEqual({
      name: 'Plain',
      attendanceId: null,
    });
  });

  it('maps the export wording', () => {
    expect(mapLeaveType('Casual Leave')).toEqual({ type: 'CASUAL', known: true });
    expect(mapLeaveType('Sick Leave')).toEqual({ type: 'SICK', known: true });
    expect(mapLeaveType('Paternity Leave')).toEqual({ type: 'OTHER', known: false });
    expect(mapLeaveStatus('approved')).toBe('APPROVED');
    expect(mapLeaveStatus('Rejected')).toBe('REJECTED');
    expect(mapLeaveStatus('maybe')).toBeNull();
  });
});

describe('parseStellarLeavesCsv', () => {
  const r = parseStellarLeavesCsv(FIXTURE);

  it('merges consecutive business days across a weekend into one record', () => {
    const alpha = r.records.filter((x) => x.attendanceId === '7');
    expect(alpha).toEqual([
      expect.objectContaining({
        type: 'CASUAL',
        startDate: '2026-07-02',
        endDate: '2026-07-06',
        days: 3,
        status: 'APPROVED',
        description: 'Family event',
        applyDate: '2026-06-30',
        externalId: 'stellar:7:2026-07-02:CASUAL',
      }),
      expect.objectContaining({
        startDate: '2026-07-08',
        endDate: '2026-07-08',
        days: 1,
        externalId: 'stellar:7:2026-07-08:CASUAL',
      }),
    ]);
  });

  it('keeps rejected leave as REJECTED and the description verbatim', () => {
    expect(r.records.find((x) => x.attendanceId === '8')).toMatchObject({
      type: 'SICK',
      status: 'REJECTED',
      description: 'Fever, with "quotes"',
      days: 1,
    });
  });

  it('skips weekend and id-less rows, and warns on an unknown type imported as OTHER', () => {
    expect(r.skipped.map((s) => [s.attendanceId, s.reason])).toEqual([
      ['8', 'weekend'],
      [null, 'no-user-id'],
    ]);
    expect(r.warnings).toEqual([
      expect.objectContaining({
        attendanceId: '9',
        rawType: 'Paternity Leave',
        reason: 'unknown-type',
      }),
    ]);
    expect(r.records.find((x) => x.attendanceId === '9')?.type).toBe('OTHER');
    expect(JSON.stringify(r.skipped)).not.toContain('Fever');
  });

  it('reports users and the range of the imported days', () => {
    expect(r.users.map((u) => u.attendanceId)).toEqual(['7', '8', '9']);
    expect(r.range).toEqual({ from: '2026-07-02', to: '2026-07-08' });
    expect(r.rowsRead).toBe(8);
  });

  it('is deterministic: the same file gives the same external ids', () => {
    expect(parseStellarLeavesCsv(FIXTURE).records).toEqual(r.records);
  });

  it('refuses an attendance export', () => {
    expect(() =>
      parseStellarLeavesCsv('"","User ID","User Name","Date","In Time"\n'),
    ).toThrow(StellarCsvError);
  });
});

describe('mergeLeaveDays', () => {
  const d = (date: string, over: Partial<StellarLeaveDay> = {}): StellarLeaveDay => ({
    attendanceId: '1',
    name: 'X',
    type: 'CASUAL',
    rawType: 'Casual Leave',
    date,
    applyDate: '2026-07-01',
    description: null,
    status: 'APPROVED',
    ...over,
  });

  it('collapses a duplicated day and makes clashing external ids unique', () => {
    const recs = mergeLeaveDays([
      d('2026-07-06'),
      d('2026-07-06'),
      d('2026-07-06', { status: 'REJECTED' }),
    ]);
    expect(recs).toHaveLength(2);
    expect(recs.map((x) => x.days)).toEqual([1, 1]);
    expect(new Set(recs.map((x) => x.externalId)).size).toBe(2);
  });

  it('does not merge different descriptions', () => {
    expect(
      mergeLeaveDays([d('2026-07-06'), d('2026-07-07', { description: 'x' })]),
    ).toHaveLength(2);
  });
});
