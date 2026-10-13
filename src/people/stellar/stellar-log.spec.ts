import { aggregateStellarDays } from './stellar-csv';
import {
  pairPunches,
  parseAccessTime,
  parseStellarLog,
  readerDirection,
  StellarLogShapeError,
  type StellarPunch,
} from './stellar-log';

const ENTRY = 'Test Office (Entry)';
const EXIT = 'Test Office (Exit)';
const entry = (id: string, time: string, unit = ENTRY, date = '2026-10-12') => ({
  unit_name: unit,
  unit_id: 'DEV1',
  registration_id: id,
  access_time: time,
  access_date: date,
  user_name: 'Test Person',
  department: 'R&D',
  card: 'None',
  access_id: '1',
});

describe('parseStellarLog', () => {
  it('reads punches, skipping the door pseudo-user and unreadable entries', () => {
    const r = parseStellarLog({
      log: [
        entry('066', '7:10:08'),
        entry('66', '17:10:08', EXIT),
        { ...entry('49845', '9:00:00'), user_name: 'EXIT' },
        entry('', '9:00:00'),
        entry('66', '25:00:00'),
        { ...entry('66', '9:00:00'), access_date: '12/10/2026' },
      ],
    });
    expect(r.punches).toEqual([
      { attendanceId: '66', userName: 'Test Person', department: 'R&D', date: '2026-10-12', timeSec: 7 * 3600 + 10 * 60 + 8, direction: 'in' },
      { attendanceId: '66', userName: 'Test Person', department: 'R&D', date: '2026-10-12', timeSec: 17 * 3600 + 10 * 60 + 8, direction: 'out' },
    ]);
    expect(r).toMatchObject({ ignored: 2, invalid: 2 });
  });

  it('a body without a log array is an error, not an empty day', () => {
    expect(() => parseStellarLog({ message: 'Invalid auth' })).toThrow(StellarLogShapeError);
    expect(() => parseStellarLog('nope')).toThrow(StellarLogShapeError);
    expect(parseStellarLog({ log: [] }).punches).toEqual([]);
  });

  it('times and reader names', () => {
    expect(parseAccessTime('0:50:34')).toBe(50 * 60 + 34);
    expect(parseAccessTime('23:59:59')).toBe(86_399);
    expect(parseAccessTime('12:00 PM')).toBeNull();
    expect(readerDirection('Nifty IT Solution LTD (Entry)')).toBe('in');
    expect(readerDirection('Nifty IT Solution LTD (Exit)')).toBe('out');
    expect(readerDirection('Lobby reader')).toBeNull();
  });
});

const punch = (time: string, direction: StellarPunch['direction'], id = '66'): StellarPunch => ({
  attendanceId: id,
  userName: 'Test Person',
  department: null,
  date: '2026-10-12',
  timeSec: parseAccessTime(time)!,
  direction,
});
const hm = (sec: number | null) =>
  sec === null ? null : `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;

describe('pairPunches', () => {
  it('pairs by reader, so a stray punch does not flip the rest of the day', () => {
    // A real day's shape: out and straight back in at 14:03, then two exits in a row.
    const sessions = pairPunches([
      punch('11:12:58', 'in'),
      punch('12:15:42', 'out'),
      punch('14:03:04', 'out'),
      punch('12:32:56', 'in'),
      punch('14:03:34', 'in'),
      punch('14:04:20', 'out'),
      punch('14:31:14', 'in'),
      punch('15:06:21', 'out'),
      punch('17:25:07', 'in'),
      punch('18:21:26', 'out'),
      punch('18:34:20', 'out'),
      punch('18:52:00', 'in'),
    ]);
    expect(sessions.map((s) => [hm(s.inSec), hm(s.outSec)])).toEqual([
      ['11:12', '12:15'],
      ['12:32', '14:03'],
      ['14:03', '14:04'],
      ['14:31', '15:06'],
      ['17:25', '18:21'],
      [null, '18:34'],
      ['18:52', null],
    ]);
    const [day] = aggregateStellarDays(sessions);
    expect(day).toMatchObject({ sessions: 7, missingOut: true });
    // 62:44 + 90:08 + 0:46 + 35:07 + 56:19 = 245:04; the time outside is not counted.
    expect(day.workedMinutes).toBe(245);
  });

  it('an entry with no exit before the next entry is a session with no out', () => {
    const s = pairPunches([punch('09:00:00', 'in'), punch('13:00:00', 'in'), punch('18:00:00', 'out')]);
    expect(s.map((x) => [hm(x.inSec), hm(x.outSec)])).toEqual([
      ['9:00', null],
      ['13:00', '18:00'],
    ]);
  });

  it('a stray exit read right after walking in is ignored when the real exit follows', () => {
    const s = pairPunches([
      punch('11:23:01', 'in'),
      punch('11:23:09', 'out'),
      punch('13:12:54', 'out'),
      punch('13:52:18', 'in'),
      punch('17:11:34', 'out'),
    ]);
    expect(s.map((x) => [hm(x.inSec), hm(x.outSec)])).toEqual([
      ['11:23', '13:12'],
      ['13:52', '17:11'],
    ]);
    // A long session followed by a second exit keeps that exit on its own.
    const t = pairPunches([punch('17:25:07', 'in'), punch('18:21:26', 'out'), punch('18:34:20', 'out')]);
    expect(t.map((x) => [hm(x.inSec), hm(x.outSec)])).toEqual([
      ['17:25', '18:21'],
      [null, '18:34'],
    ]);
  });

  it('a badge read twice within a minute counts once', () => {
    const s = pairPunches([punch('09:00:00', 'in'), punch('09:00:20', 'in'), punch('18:00:00', 'out')]);
    expect(s).toHaveLength(1);
    expect(hm(s[0].inSec)).toBe('9:00');
  });

  it('a reader with no direction alternates, and days and people pair separately', () => {
    const s = pairPunches([
      punch('09:00:00', null),
      punch('12:00:00', null),
      { ...punch('10:00:00', 'in'), date: '2026-10-13' },
      punch('09:30:00', 'in', '7'),
    ]);
    expect(s.map((x) => [x.attendanceId, x.date, hm(x.inSec), hm(x.outSec)])).toEqual([
      ['66', '2026-10-12', '9:00', '12:00'],
      ['66', '2026-10-13', '10:00', null],
      ['7', '2026-10-12', '9:30', null],
    ]);
  });
});
