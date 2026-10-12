import { dhakaInstant } from '../people-dates';
import { headerIndex, parseCsv, parseIsoDate, stellarId } from './csv';

/**
 * Pure parsing of a Stellar HRM attendance export (the office door system).
 *
 * Shape: `"","User ID","User Name","Department","Date","In Time","Out Time","Total Hour","Note"`,
 * one row per in/out session, several per day. `-` means missing; a day with no
 * punches is a row with `-` times. Times are Dhaka local (`06:41:31 PM`),
 * `Total Hour` is `HH:MM:SS`. The `EXIT` user is the door itself, not a person.
 */

/** One in/out session, times in seconds after Dhaka midnight of `date`. */
export interface StellarSession {
  attendanceId: string;
  userName: string;
  department: string | null;
  date: string;
  inSec: number | null;
  /** May exceed 86 400 when the session crosses midnight (it belongs to `date`). */
  outSec: number | null;
  totalSec: number | null;
  note: string | null;
}

/** One person-day, aggregated from its sessions. */
export interface StellarDay {
  attendanceId: string;
  /** Dhaka calendar date, `YYYY-MM-DD`. */
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  /** Sessions with at least one punch. 0 = no presence that day. */
  sessions: number;
  /** Sum of the sessions' worked time, whole minutes; null with no punches. */
  workedMinutes: number | null;
  /** The latest session has an in but no out (still inside, or a forgotten punch). */
  missingOut: boolean;
  note: string | null;
}

export interface StellarUser {
  attendanceId: string;
  name: string;
  department: string | null;
}

export interface StellarAttendanceParse {
  days: StellarDay[];
  /** Every real user in the file, by Stellar ID, in first-seen order. */
  users: StellarUser[];
  /** First and last date in the file; null for a file with no usable rows. */
  range: { from: string; to: string } | null;
  /** Data rows read (excluding the header). */
  rowsRead: number;
  /** Door pseudo-user rows (`EXIT`) and rows without a numeric user id. */
  ignoredRows: number;
  /** Rows whose date or times could not be read. */
  invalidRows: number;
}

const EXIT_USER = 'exit';
const DASH = /^-*$/;

/** `06:41:31 PM` / `6:41 am` / `18:41:31` -> seconds after midnight; null for `-`; NaN when unreadable. */
export function parseClock(raw: string): number | null {
  const s = raw.trim();
  if (DASH.test(s)) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(s);
  if (!m) return NaN;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  if (min > 59 || sec > 59) return NaN;
  if (m[4]) {
    if (h < 1 || h > 12) return NaN;
    const pm = m[4].toLowerCase() === 'pm';
    // 12:xx AM is just after midnight; 12:xx PM is just after noon.
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return NaN;
  return h * 3600 + min * 60 + sec;
}

/** `HH:MM:SS` duration -> seconds; null for `-`; NaN when unreadable. Hours may exceed 23. */
export function parseDuration(raw: string): number | null {
  const s = raw.trim();
  if (DASH.test(s)) return null;
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Read the export into sessions, dropping the door pseudo-user and unreadable rows. */
export function parseStellarSessions(text: string): {
  sessions: StellarSession[];
  users: StellarUser[];
  rowsRead: number;
  ignoredRows: number;
  invalidRows: number;
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return emptySessions();
  const col = headerIndex(
    rows[0],
    {
      id: 'User ID',
      name: 'User Name',
      date: 'Date',
      in: 'In Time',
      out: 'Out Time',
      total: 'Total Hour',
    },
    { department: 'Department', note: 'Note' },
    'Stellar HRM attendance',
  );
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  const sessions: StellarSession[] = [];
  const users = new Map<string, StellarUser>();
  let ignoredRows = 0;
  let invalidRows = 0;
  for (const r of rows.slice(1)) {
    const rawId = cell(r, col.id);
    const userName = cell(r, col.name);
    if (!/^\d+$/.test(rawId) || userName.toLowerCase() === EXIT_USER) {
      ignoredRows++;
      continue;
    }
    const attendanceId = stellarId(rawId);
    const date = parseIsoDate(cell(r, col.date));
    const inSec = parseClock(cell(r, col.in));
    let outSec = parseClock(cell(r, col.out));
    const totalSec = parseDuration(cell(r, col.total));
    if (
      !date ||
      Number.isNaN(inSec) ||
      Number.isNaN(outSec) ||
      Number.isNaN(totalSec)
    ) {
      invalidRows++;
      continue;
    }
    // An out earlier than its in crossed midnight: it still belongs to the listed date.
    if (inSec !== null && outSec !== null && outSec < inSec) outSec += 86_400;
    const department = cell(r, col.department) || null;
    if (!users.has(attendanceId))
      users.set(attendanceId, { attendanceId, name: userName, department });
    sessions.push({
      attendanceId,
      userName,
      department,
      date,
      inSec,
      outSec,
      totalSec,
      note: cell(r, col.note) || null,
    });
  }
  return {
    sessions,
    users: [...users.values()],
    rowsRead: rows.length - 1,
    ignoredRows,
    invalidRows,
  };
}

function emptySessions() {
  return {
    sessions: [],
    users: [],
    rowsRead: 0,
    ignoredRows: 0,
    invalidRows: 0,
  };
}

/**
 * Group sessions by (person, date) into days. `firstIn` is the earliest in;
 * `lastOut` the latest out seen, with `missingOut` when the latest session
 * (by its in time) has no out. An exact duplicate row (same in, out and total,
 * as when two overlapping exports are joined) counts once. Worked time is the
 * union of the sessions' in-out spans, so overlapping sessions never count
 * twice; a session missing a punch adds its `Total Hour` when it has one.
 * Seconds are summed and rounded once. A day of only `-` rows is a day with no
 * presence (sessions 0).
 */
export function aggregateStellarDays(sessions: StellarSession[]): StellarDay[] {
  const groups = new Map<string, StellarSession[]>();
  for (const s of sessions) {
    const key = `${s.attendanceId}|${s.date}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const days: StellarDay[] = [];
  for (const list of groups.values()) {
    const { attendanceId, date } = list[0];
    const seen = new Set<string>();
    const punched = list.filter((s) => {
      if (s.inSec === null && s.outSec === null) return false;
      const k = `${s.inSec}|${s.outSec}|${s.totalSec}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const ins = punched.flatMap((s) => (s.inSec !== null ? [s.inSec] : []));
    const outs = punched.flatMap((s) => (s.outSec !== null ? [s.outSec] : []));
    const spans = punched
      .flatMap((s) =>
        s.inSec !== null && s.outSec !== null && s.outSec > s.inSec
          ? [[s.inSec, s.outSec] as const]
          : [],
      )
      .sort((a, b) => a[0] - b[0]);
    let workedSec = 0;
    let end = -Infinity;
    for (const [from, to] of spans) {
      // Only the part after what is already counted.
      if (to > end) workedSec += to - Math.max(from, end);
      end = Math.max(end, to);
    }
    for (const s of punched)
      if ((s.inSec === null || s.outSec === null) && s.totalSec !== null)
        workedSec += s.totalSec;
    const latest = [...punched].sort(
      (a, b) => (a.inSec ?? a.outSec ?? 0) - (b.inSec ?? b.outSec ?? 0),
    )[punched.length - 1];
    const notes = [
      ...new Set(list.flatMap((s) => (s.note ? [s.note] : []))),
    ];
    days.push({
      attendanceId,
      date,
      firstIn: ins.length ? dhakaInstant(date, Math.min(...ins) / 60) : null,
      lastOut: outs.length ? dhakaInstant(date, Math.max(...outs) / 60) : null,
      sessions: punched.length,
      workedMinutes: punched.length ? Math.round(workedSec / 60) : null,
      missingOut: !!latest && latest.inSec !== null && latest.outSec === null,
      note: notes.length ? notes.join(' | ') : null,
    });
  }
  return days.sort(
    (a, b) =>
      a.attendanceId.localeCompare(b.attendanceId) ||
      a.date.localeCompare(b.date),
  );
}

/** Parse and aggregate a whole attendance export. Throws `StellarCsvError` for a file of the wrong shape. */
export function parseStellarAttendanceCsv(text: string): StellarAttendanceParse {
  const parsed = parseStellarSessions(text);
  const days = aggregateStellarDays(parsed.sessions);
  let from: string | null = null;
  let to: string | null = null;
  for (const d of days) {
    if (!from || d.date < from) from = d.date;
    if (!to || d.date > to) to = d.date;
  }
  return {
    days,
    users: parsed.users,
    range: from && to ? { from, to } : null,
    rowsRead: parsed.rowsRead,
    ignoredRows: parsed.ignoredRows,
    invalidRows: parsed.invalidRows,
  };
}
