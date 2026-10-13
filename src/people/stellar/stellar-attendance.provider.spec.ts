import { StellarApiClient } from './stellar-api.client';
import { StellarAttendanceProvider } from './stellar-attendance.provider';

const people = [
  { email: 'a@x.test', attendanceId: '66', joinDate: '2026-01-01', exitDate: null },
  { email: 'b@x.test', attendanceId: '7', joinDate: '2026-10-12', exitDate: null },
  { email: 'c@x.test', attendanceId: null, joinDate: '2026-01-01', exitDate: null },
];
const e = (id: string, date: string, time: string, unit: 'Entry' | 'Exit') => ({
  unit_name: `Test Office (${unit})`,
  registration_id: id,
  access_date: date,
  access_time: time,
  user_name: 'Test',
  department: 'R&D',
});

function provider(log: unknown[]) {
  const api = new StellarApiClient(
    { authUser: 'u', authCode: 'c' },
    async () => ({ set: async () => 'OK', pttl: async () => 0 }),
    (async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ log }) })) as never,
  );
  return new StellarAttendanceProvider(api);
}

describe('StellarAttendanceProvider', () => {
  it('turns punches into per-day rows keyed by email, inside the employment only', async () => {
    const r = await provider([
      e('66', '2026-10-12', '9:00:00', 'Entry'),
      e('66', '2026-10-12', '13:00:00', 'Exit'),
      e('66', '2026-10-12', '14:00:00', 'Entry'),
      e('7', '2026-10-11', '10:00:00', 'Entry'), // before Test B joined
      e('7', '2026-10-12', '10:00:00', 'Entry'),
      e('100', '2026-10-12', '10:00:00', 'Entry'), // no such employee
    ]).fetch(people, '2026-10-11', '2026-10-12');
    expect(r.leaves).toEqual([]);
    expect(r.unmatchedIds).toEqual(['100']);
    expect(r.attendance.map((a) => [a.email, a.date, a.sessions, a.workedMinutes, a.missingOut])).toEqual([
      ['a@x.test', '2026-10-12', 2, 240, true],
      ['b@x.test', '2026-10-12', 1, 0, true],
    ]);
    expect(r.attendance[0].lastOut).toEqual(new Date('2026-10-12T07:00:00.000Z')); // 13:00 Dhaka
  });

  it('can sync only with credentials, three days per fetch', () => {
    const p = provider([]);
    expect(p.canSync).toBe(true);
    expect(p.maxDaysPerFetch).toBe(3);
    const off = new StellarAttendanceProvider(new StellarApiClient(null, () => Promise.reject(new Error('x'))));
    expect(off.canSync).toBe(false);
  });
});
