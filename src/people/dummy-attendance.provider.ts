import type {
  AttendanceFetchResult,
  AttendanceProvider,
  ProviderAttendanceRow,
  ProviderLeaveRow,
  ProviderPerson,
} from './attendance-provider';
import {
  addDays,
  businessDaysIn,
  dhakaDateOf,
  dhakaInstant,
} from './people-dates';

/** Share of business days that are a sick / casual day (approved, one-day). */
const SICK_RATE = 0.04;
const CASUAL_RATE = 0.04;
/** Share of PRESENT days that start late. */
const LATE_RATE = 0.12;
/**
 * Chance that any given business day carries a casual-leave request. Decided per
 * (email, day) rather than per run so the same request keeps the same
 * externalId on every sync; ~3.5% over a 10-business-day window is about 30% of
 * people having one open. While the day is in the future the request is
 * PENDING; once the day arrives it is reported APPROVED (and the person is on
 * leave that day), so undecided demo requests don't sit PENDING forever. The
 * sync never overwrites a request somebody decided by hand.
 */
const PENDING_DAY_RATE = 0.035;
const PENDING_WINDOW_DAYS = 14;

/** First-in minutes after midnight, Dhaka: on time 08:40-09:30, late 09:31-10:40. */
const ON_TIME_IN = { min: 8 * 60 + 40, max: 9 * 60 + 30 };
const LATE_IN = { min: 9 * 60 + 31, max: 10 * 60 + 40 };
/** Last-out minutes after midnight, Dhaka: 17:30-19:30. */
const OUT = { min: 17 * 60 + 30, max: 19 * 60 + 30 };

/** FNV-1a, then a murmur-style finaliser, mapped to [0, 1). Deterministic and dependency-free. */
function unit(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

const between = (u: number, lo: number, hi: number): number =>
  lo + Math.floor(u * (hi - lo + 1));

/**
 * Deterministic demo data, seeded from `email + date` so a re-sync reproduces
 * the same rows (idempotent) and tests are stable. Every row is stamped
 * `source = 'dummy'` so it can be purged with one DELETE when the real API
 * lands. It never invents attendance after `now`.
 */
export class DummyAttendanceProvider implements AttendanceProvider {
  readonly source = 'dummy';

  constructor(private readonly now: () => Date = () => new Date()) {}

  fetch(
    people: ProviderPerson[],
    from: string,
    to: string,
  ): Promise<AttendanceFetchResult> {
    const now = this.now();
    const today = dhakaDateOf(now);
    const attendance: ProviderAttendanceRow[] = [];
    const leaves: ProviderLeaveRow[] = [];

    for (const p of people) {
      const email = p.email;
      const last = minDate(to, today, p.exitDate);
      const first = p.joinDate > from ? p.joinDate : from;

      for (const date of businessDaysIn(first, last)) {
        if (isRequestDay(email, date)) {
          leaves.push(requestRow(email, date, 'APPROVED'));
          continue;
        }
        const kind = unit(`${email}|${date}|kind`);
        if (kind < SICK_RATE + CASUAL_RATE) {
          const sick = kind < SICK_RATE;
          leaves.push({
            email,
            externalId: `dummy:${email}:${date}`,
            type: sick ? 'SICK' : 'CASUAL',
            startDate: date,
            endDate: date,
            days: 1,
            status: 'APPROVED',
            reason: sick
              ? 'Sick leave (demo data)'
              : 'Casual leave (demo data)',
          });
          continue;
        }
        const late = unit(`${email}|${date}|late`) < LATE_RATE;
        const inRange = late ? LATE_IN : ON_TIME_IN;
        const firstIn = dhakaInstant(
          date,
          between(unit(`${email}|${date}|in`), inRange.min, inRange.max),
        );
        // Nothing is invented for the future: someone who has not "arrived" yet has no row,
        // and a last-out that has not happened yet is null (today before ~17:30).
        if (firstIn.getTime() > now.getTime()) continue;
        const out = dhakaInstant(
          date,
          between(unit(`${email}|${date}|out`), OUT.min, OUT.max),
        );
        attendance.push({
          email,
          date,
          firstIn,
          lastOut: out.getTime() > now.getTime() ? null : out,
        });
      }

      const windowEnd =
        p.exitDate && p.exitDate < addDays(today, PENDING_WINDOW_DAYS)
          ? p.exitDate
          : addDays(today, PENDING_WINDOW_DAYS);
      for (const date of businessDaysIn(addDays(today, 1), windowEnd)) {
        if (date < p.joinDate) continue;
        if (!isRequestDay(email, date)) continue;
        leaves.push(requestRow(email, date, 'PENDING'));
      }
    }
    return Promise.resolve({ attendance, leaves });
  }
}

function isRequestDay(email: string, date: string): boolean {
  return unit(`${email}|${date}|pending`) < PENDING_DAY_RATE;
}

/** Same externalId whether PENDING (future) or APPROVED (arrived), so the sync updates one row. */
function requestRow(
  email: string,
  date: string,
  status: 'PENDING' | 'APPROVED',
): ProviderLeaveRow {
  return {
    email,
    externalId: `dummy:pending:${email}:${date}`,
    type: 'CASUAL',
    startDate: date,
    endDate: date,
    days: 1,
    status,
    reason: 'Casual leave request (demo data)',
  };
}

function minDate(a: string, b: string, c: string | null): string {
  let m = a < b ? a : b;
  if (c && c < m) m = c;
  return m;
}
