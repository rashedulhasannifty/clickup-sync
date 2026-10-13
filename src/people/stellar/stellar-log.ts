import { parseIsoDate, stellarId } from './csv';
import type { StellarSession } from './stellar-csv';

/**
 * Pure reading of the Stellar HRM (RAMS) API's `fetch_log` response: raw door
 * punches, one per badge, each from the Entry or the Exit reader. Pairing uses
 * the reader, not the order: an Entry opens a session, the next Exit closes it.
 * (The CSV export alternates in/out regardless of the reader, so one stray punch
 * flips every later session of the day; the API does not have that problem.)
 *
 * Each Dhaka date is paired on its own: in Jul-Oct 2026 nobody's session crossed
 * midnight, and the API answers at most a few days per call anyway.
 */

export type PunchDirection = 'in' | 'out';

export interface StellarPunch {
  attendanceId: string;
  userName: string;
  department: string | null;
  /** Dhaka calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Seconds after Dhaka midnight. */
  timeSec: number;
  /** From the reader's name; null for a reader that is neither (then punches alternate). */
  direction: PunchDirection | null;
}

export interface StellarLogParse {
  punches: StellarPunch[];
  /** The door pseudo-user (`EXIT`), and entries without a numeric user id. */
  ignored: number;
  /** Entries whose date or time could not be read. */
  invalid: number;
}

/** A response without a `log` array: wrong credentials, a blocked IP, or a changed API. */
export class StellarLogShapeError extends Error {}

const EXIT_USER = 'exit';

/** `7:10:08` / `17:10:08` (24-hour, hour not padded) -> seconds; null when unreadable. */
export function parseAccessTime(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

/** The reader's direction from its name ("Nifty IT Solution LTD (Entry)" / "(Exit)"). */
export function readerDirection(unitName: string): PunchDirection | null {
  if (/\bentry\b|\bin\b/i.test(unitName)) return 'in';
  if (/\bexit\b|\bout\b/i.test(unitName)) return 'out';
  return null;
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

/** Read a `fetch_log` response body. Throws `StellarLogShapeError` when it has no `log` array. */
export function parseStellarLog(body: unknown): StellarLogParse {
  const log =
    body && typeof body === 'object' && 'log' in body
      ? (body as { log: unknown }).log
      : undefined;
  if (!Array.isArray(log)) {
    throw new StellarLogShapeError(
      'Stellar HRM answered without a punch log (check STELLAR_AUTH_USER / STELLAR_AUTH_CODE)',
    );
  }
  const punches: StellarPunch[] = [];
  let ignored = 0;
  let invalid = 0;
  for (const raw of log) {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = str(e.registration_id).trim();
    const userName = str(e.user_name).trim();
    if (!/^\d+$/.test(id) || userName.toLowerCase() === EXIT_USER) {
      ignored++;
      continue;
    }
    const date = parseIsoDate(str(e.access_date));
    const timeSec = parseAccessTime(str(e.access_time));
    if (!date || timeSec === null) {
      invalid++;
      continue;
    }
    punches.push({
      attendanceId: stellarId(id),
      userName,
      department: str(e.department).trim() || null,
      date,
      timeSec,
      direction: readerDirection(str(e.unit_name)),
    });
  }
  return { punches, ignored, invalid };
}

/** Two punches on the same reader this close together are one badge, read twice. */
const DOUBLE_READ_SEC = 60;
/**
 * A session this short followed by another exit with nothing open was a stray
 * read of the exit reader while walking in (in 11:23:01, "out" 11:23:09, out
 * 13:12:54): the later exit closes it instead of standing alone.
 */
const STRAY_EXIT_SEC = 120;

/**
 * Pair one person's punches into in/out sessions, per Dhaka date. An Entry
 * opens a session (closing an open one as "no exit"); an Exit closes the open
 * session, or stands alone as an exit-only session when nothing is open (unless
 * the previous session lasted under `STRAY_EXIT_SEC`: then it closes that one). The
 * last open session of a day has no out (still inside, or a missed exit). A
 * reader with no direction alternates: in when nothing is open, else out.
 * The result feeds `aggregateStellarDays`, the same day maths as the CSV import.
 */
export function pairPunches(punches: StellarPunch[]): StellarSession[] {
  const groups = new Map<string, StellarPunch[]>();
  for (const p of punches) {
    const key = `${p.attendanceId}|${p.date}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const sessions: StellarSession[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.timeSec - b.timeSec);
    const { attendanceId, userName, department, date } = list[0];
    const daySessions: StellarSession[] = [];
    const session = (inSec: number | null, outSec: number | null) =>
      daySessions.push({
        attendanceId,
        userName,
        department,
        date,
        inSec,
        outSec,
        totalSec: inSec !== null && outSec !== null ? outSec - inSec : null,
        note: null,
      });
    let open: number | null = null;
    let last: StellarPunch | null = null;
    for (const p of list) {
      const dir = p.direction ?? (open === null ? 'in' : 'out');
      if (
        last &&
        last.direction === p.direction &&
        p.timeSec - last.timeSec < DOUBLE_READ_SEC
      )
        continue;
      last = p;
      const previous = daySessions[daySessions.length - 1];
      if (dir === 'in') {
        if (open !== null) session(open, null);
        open = p.timeSec;
      } else if (open !== null) {
        session(open, p.timeSec);
        open = null;
      } else if (
        previous?.totalSec != null &&
        previous.inSec !== null &&
        previous.totalSec < STRAY_EXIT_SEC
      ) {
        previous.outSec = p.timeSec;
        previous.totalSec = p.timeSec - previous.inSec;
      } else {
        session(null, p.timeSec);
      }
    }
    if (open !== null) session(open, null);
    sessions.push(...daySessions);
  }
  return sessions;
}
