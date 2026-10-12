import { detectStellarExport, parseCsv, StellarCsvError } from './csv';
import {
  aggregateStellarDays,
  parseClock,
  parseDuration,
  parseStellarAttendanceCsv,
  parseStellarSessions,
} from './stellar-csv';
import { dhakaInstant } from '../people-dates';

/** Fake people only. Mirrors the real export: leading unnamed column, all fields quoted. */
const HEADER =
  '"","User ID","User Name","Department","Date","In Time","Out Time","Total Hour","Note"';
const row = (...cells: string[]) => cells.map((c) => `"${c}"`).join(',');

const FIXTURE = [
  '﻿' + HEADER,
  // Multi-session day with a missing out on the LAST session.
  row('', '7', 'TEST ALPHA', 'R&D', '2026-07-01', '11:05:07 AM', '01:12:32 PM', '02:07:25', ''),
  row('', '7', 'TEST ALPHA', 'R&D', '2026-07-01', '01:18:09 PM', '06:46:13 PM', '05:28:04', 'IN: Went to client office'),
  row('', '7', 'TEST ALPHA', 'R&D', '2026-07-01', '08:18:32 PM', '-', '-', 'IN: Went to client office'),
  // A day with no punches at all.
  row('', '7', 'TEST ALPHA', 'R&D', '2026-07-02', '-', '-', '-', ''),
  // 12 AM / 12 PM edges, Total missing but both times present.
  row('', '8', 'TEST BETA', 'BPO-B', '2026-07-01', '12:10:00 PM', '12:40:00 PM', '-', ''),
  row('', '8', 'TEST BETA', 'BPO-B', '2026-07-01', '02:00:00 PM', '11:55:30 PM', '09:55:30', 'Out: ""late"" shift, with a comma'),
  // Session crossing midnight: belongs to the listed date.
  row('', '8', 'TEST BETA', 'BPO-B', '2026-07-02', '11:30:00 PM', '12:30:00 AM', '01:00:00', ''),
  // The door pseudo-user and a row without a numeric id.
  row('', '49845', 'EXIT', '', '2026-07-01', '09:00:00 AM', '09:00:05 AM', '00:00:05', ''),
  row('', '', 'NOBODY', '', '2026-07-01', '09:00:00 AM', '-', '-', ''),
  // An unreadable time.
  row('', '9', 'TEST GAMMA', 'BPO-A', '2026-07-01', '25:00:00 PM', '-', '-', ''),
].join('\r\n') + '\r\n';

describe('parseCsv', () => {
  it('reads quoted fields, escaped quotes, embedded commas/newlines, CRLF and a BOM', () => {
    expect(
      parseCsv('﻿"a","b ""q"", c"\r\n"x\ny",2\n\n'),
    ).toEqual([
      ['a', 'b "q", c'],
      ['x\ny', '2'],
    ]);
  });
});

describe('parseClock / parseDuration', () => {
  it('reads 12-hour clocks, including 12 AM as midnight and 12 PM as noon', () => {
    expect(parseClock('06:41:31 PM')).toBe(18 * 3600 + 41 * 60 + 31);
    expect(parseClock('12:05:00 AM')).toBe(5 * 60);
    expect(parseClock('12:05:00 PM')).toBe(12 * 3600 + 5 * 60);
    expect(parseClock('9:30 am')).toBe(9.5 * 3600);
    expect(parseClock('18:00:00')).toBe(18 * 3600);
  });

  it('`-` is missing and garbage is NaN', () => {
    expect(parseClock('-')).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock('13:00:00 PM')).toBeNaN();
    expect(parseClock('soon')).toBeNaN();
    expect(parseDuration('-')).toBeNull();
    expect(parseDuration('10:02:03')).toBe(36123);
    expect(parseDuration('1h')).toBeNaN();
  });
});

describe('parseStellarSessions', () => {
  it('drops EXIT and id-less rows, counts unreadable ones, and keeps users with department', () => {
    const r = parseStellarSessions(FIXTURE);
    expect(r.rowsRead).toBe(10);
    expect(r.ignoredRows).toBe(2);
    expect(r.invalidRows).toBe(1);
    expect(r.sessions).toHaveLength(7);
    expect(r.users).toEqual([
      { attendanceId: '7', name: 'TEST ALPHA', department: 'R&D' },
      { attendanceId: '8', name: 'TEST BETA', department: 'BPO-B' },
    ]);
  });

  it('refuses a file without the attendance columns', () => {
    expect(() => parseStellarSessions('"a","b"\n"1","2"\n')).toThrow(
      StellarCsvError,
    );
  });
});

describe('aggregateStellarDays', () => {
  const days = parseStellarAttendanceCsv(FIXTURE).days;
  const day = (id: string, date: string) =>
    days.find((d) => d.attendanceId === id && d.date === date)!;

  it('first in, latest out seen, and missingOut when the last session has no out', () => {
    const d = day('7', '2026-07-01');
    expect(d.firstIn).toEqual(dhakaInstant('2026-07-01', 11 * 60 + 5 + 7 / 60));
    expect(d.lastOut).toEqual(
      dhakaInstant('2026-07-01', 18 * 60 + 46 + 13 / 60),
    );
    expect(d.missingOut).toBe(true);
    expect(d.sessions).toBe(3);
    // 02:07:25 + 05:28:04 = 7:35:29 -> 455.48 min -> 455
    expect(d.workedMinutes).toBe(455);
    expect(d.note).toBe('IN: Went to client office');
  });

  it('a day of only `-` rows is a day with no presence', () => {
    expect(day('7', '2026-07-02')).toMatchObject({
      firstIn: null,
      lastOut: null,
      sessions: 0,
      workedMinutes: null,
      missingOut: false,
      note: null,
    });
  });

  it('falls back to out - in when Total is `-`, and keeps notes with commas and quotes', () => {
    const d = day('8', '2026-07-01');
    // 30:00 (computed) + 9:55:30 = 625.5 min, rounded once at the end
    expect(d.workedMinutes).toBe(626);
    expect(d.missingOut).toBe(false);
    expect(d.note).toBe('Out: "late" shift, with a comma');
  });

  it('a session crossing midnight stays on its listed date', () => {
    const d = day('8', '2026-07-02');
    expect(d.firstIn).toEqual(dhakaInstant('2026-07-02', 23 * 60 + 30));
    expect(d.lastOut).toEqual(dhakaInstant('2026-07-03', 30));
    expect(d.workedMinutes).toBe(60);
  });

  it('de-duplicates notes and joins distinct ones', () => {
    const [d] = aggregateStellarDays([
      { attendanceId: '1', userName: 'X', department: null, date: '2026-07-06', inSec: 32400, outSec: 36000, totalSec: 3600, note: 'a' },
      { attendanceId: '1', userName: 'X', department: null, date: '2026-07-06', inSec: 37000, outSec: 38000, totalSec: 1000, note: 'b' },
      { attendanceId: '1', userName: 'X', department: null, date: '2026-07-06', inSec: 39000, outSec: 40000, totalSec: 1000, note: 'a' },
    ]);
    expect(d.note).toBe('a | b');
    expect(d.workedMinutes).toBe(Math.round(5600 / 60));
  });

  it('reports the file range', () => {
    expect(parseStellarAttendanceCsv(FIXTURE).range).toEqual({
      from: '2026-07-01',
      to: '2026-07-02',
    });
  });
});

describe('detectStellarExport', () => {
  it('tells the two exports apart by header', () => {
    expect(detectStellarExport(FIXTURE)).toBe('attendance');
    expect(
      detectStellarExport(
        '"","User Name","Leave Type","Date","Apply Date","Description","Status","Action"\n',
      ),
    ).toBe('leaves');
    expect(detectStellarExport('name,email\n')).toBeNull();
  });
});

describe('aggregateStellarDays: overlaps and duplicates', () => {
  const s = (inH: number | null, outH: number | null, totalH: number | null = null) => ({
    attendanceId: '41',
    userName: 'A',
    department: null,
    date: '2026-09-01',
    inSec: inH === null ? null : inH * 3600,
    outSec: outH === null ? null : outH * 3600,
    totalSec: totalH === null ? null : totalH * 3600,
    note: null,
  });
  it('counts overlapping sessions once (the union of their spans)', () => {
    const [d] = aggregateStellarDays([s(9, 13, 4), s(12, 17, 5)]);
    expect(d).toMatchObject({ workedMinutes: 480, sessions: 2 });
  });
  it('an exact duplicate row (two exports joined) counts once', () => {
    const [d] = aggregateStellarDays([s(9, 13, 4), s(9, 13, 4)]);
    expect(d).toMatchObject({ workedMinutes: 240, sessions: 1 });
  });
  it('a session missing a punch adds its total', () => {
    const [d] = aggregateStellarDays([s(9, 13, 4), s(14, null, 2)]);
    expect(d).toMatchObject({ workedMinutes: 360, missingOut: true });
  });
});

describe('stellarId', () => {
  it('drops leading zeros so "041" matches employee 41', async () => {
    const { stellarId } = await import('./csv');
    expect(stellarId('041')).toBe('41');
    expect(stellarId('0')).toBe('0');
    expect(stellarId(' 66 ')).toBe('66');
  });
});
