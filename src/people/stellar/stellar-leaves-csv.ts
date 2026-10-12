import { addDays, isBusinessDay } from '../people-dates';
import type { LeaveStatusValue, LeaveTypeValue } from '../people.types';
import { headerIndex, parseCsv, parseIsoDate } from './csv';

/**
 * Pure parsing of a Stellar HRM leave export.
 *
 * Shape: `"","User Name","Leave Type","Date","Apply Date","Description","Status","Action"`,
 * one row per leave DAY. `User Name` is `Name (41)`: the Stellar User ID is in
 * the parentheses. `Action` is UI junk. `Description` is free text that can
 * hold health and family details: it is stored for Owner/Admin and NEVER logged.
 */

export const STELLAR_LEAVE_SOURCE = 'stellar';

/** One leave day as exported. */
export interface StellarLeaveDay {
  attendanceId: string;
  name: string;
  type: LeaveTypeValue;
  /** The export's own wording, kept when it maps to OTHER. */
  rawType: string;
  date: string;
  /** Calendar day of `Apply Date` (the exports stamp each day a few seconds apart). */
  applyDate: string | null;
  description: string | null;
  status: LeaveStatusValue;
}

/** Consecutive leave days merged into one `LeaveRecord`-shaped range. */
export interface StellarLeaveRecord {
  attendanceId: string;
  name: string;
  type: LeaveTypeValue;
  rawType: string;
  startDate: string;
  /** Inclusive. */
  endDate: string;
  /** Business days in the range (weekend days are never leave days). */
  days: number;
  status: LeaveStatusValue;
  description: string | null;
  applyDate: string | null;
  /** Stable per record: re-imports of the same file produce the same ids. */
  externalId: string;
}

/** A row the import will not write, and why. Shown in the preview; never carries the description. */
export interface StellarLeaveFlag {
  attendanceId: string | null;
  name: string;
  date: string | null;
  rawType: string;
  reason:
    | 'weekend'
    | 'unknown-type'
    | 'unknown-status'
    | 'bad-date'
    | 'no-user-id';
}

export interface StellarLeaveParse {
  records: StellarLeaveRecord[];
  users: { attendanceId: string; name: string }[];
  range: { from: string; to: string } | null;
  rowsRead: number;
  /** Rows skipped (weekend, unreadable). */
  skipped: StellarLeaveFlag[];
  /** Rows imported but worth a look (leave type mapped to OTHER). */
  warnings: StellarLeaveFlag[];
}

/** `Test Name (41)` -> { name: 'Test Name', id: '41' }; id null when there are no parentheses with digits. */
export function splitUserName(raw: string): {
  name: string;
  attendanceId: string | null;
} {
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(raw.trim());
  return m
    ? { name: m[1].trim(), attendanceId: m[2] }
    : { name: raw.trim(), attendanceId: null };
}

/** Export leave type -> ours. Unknown wording becomes OTHER (and is flagged by the caller). */
export function mapLeaveType(raw: string): {
  type: LeaveTypeValue;
  known: boolean;
} {
  const s = raw.trim().toLowerCase();
  if (/\bcasual\b/.test(s)) return { type: 'CASUAL', known: true };
  if (/\bsick\b|\bmedical\b/.test(s)) return { type: 'SICK', known: true };
  if (/\bannual\b|\bearned\b/.test(s)) return { type: 'ANNUAL', known: true };
  if (/\bunpaid\b|without pay/.test(s)) return { type: 'UNPAID', known: true };
  return { type: 'OTHER', known: false };
}

export function mapLeaveStatus(raw: string): LeaveStatusValue | null {
  const s = raw.trim().toLowerCase();
  if (s === 'approved') return 'APPROVED';
  if (s === 'rejected' || s === 'declined') return 'REJECTED';
  if (s === 'pending') return 'PENDING';
  if (s === 'cancelled' || s === 'canceled') return 'CANCELLED';
  return null;
}

/** Read the export into leave days; weekend and unreadable rows are reported, not imported. */
export function parseStellarLeaveDays(text: string): {
  days: StellarLeaveDay[];
  rowsRead: number;
  skipped: StellarLeaveFlag[];
  warnings: StellarLeaveFlag[];
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return { days: [], rowsRead: 0, skipped: [], warnings: [] };
  const col = headerIndex(
    rows[0],
    {
      user: 'User Name',
      type: 'Leave Type',
      date: 'Date',
      status: 'Status',
    },
    { apply: 'Apply Date', description: 'Description' },
    'Stellar HRM leave',
  );
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const days: StellarLeaveDay[] = [];
  const skipped: StellarLeaveFlag[] = [];
  const warnings: StellarLeaveFlag[] = [];
  for (const r of rows.slice(1)) {
    const { name, attendanceId } = splitUserName(cell(r, col.user));
    const rawType = cell(r, col.type);
    const date = parseIsoDate(cell(r, col.date));
    const flag = (reason: StellarLeaveFlag['reason']): StellarLeaveFlag => ({
      attendanceId,
      name,
      date,
      rawType,
      reason,
    });
    if (!attendanceId) {
      skipped.push(flag('no-user-id'));
      continue;
    }
    if (!date) {
      skipped.push(flag('bad-date'));
      continue;
    }
    const status = mapLeaveStatus(cell(r, col.status));
    if (!status) {
      skipped.push(flag('unknown-status'));
      continue;
    }
    if (!isBusinessDay(date)) {
      skipped.push(flag('weekend'));
      continue;
    }
    const { type, known } = mapLeaveType(rawType);
    if (!known) warnings.push(flag('unknown-type'));
    const apply = cell(r, col.apply);
    days.push({
      attendanceId,
      name,
      type,
      rawType,
      date,
      applyDate: apply ? parseIsoDate(apply) : null,
      description: cell(r, col.description) || null,
      status,
    });
  }
  return { days, rowsRead: rows.length - 1, skipped, warnings };
}

/** The next Mon-Fri date after `iso`. */
function nextBusinessDay(iso: string): string {
  let d = addDays(iso, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

/**
 * Merge leave days into ranges: consecutive business days (a weekend in
 * between does not break a run) for the same person, type, status,
 * description and apply date become one record. Duplicate rows for the same
 * day collapse. `externalId` is `stellar:<id>:<start>:<TYPE>`, made unique
 * with the status if two records would share it.
 */
export function mergeLeaveDays(days: StellarLeaveDay[]): StellarLeaveRecord[] {
  const groups = new Map<string, StellarLeaveDay[]>();
  for (const d of days) {
    const key = JSON.stringify([
      d.attendanceId,
      d.type,
      d.rawType,
      d.status,
      d.description,
      d.applyDate,
    ]);
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }
  const records: StellarLeaveRecord[] = [];
  for (const list of groups.values()) {
    const dates = [...new Set(list.map((d) => d.date))].sort();
    const head = list[0];
    let start = dates[0];
    let prev = dates[0];
    let count = 1;
    const flush = () =>
      records.push({
        attendanceId: head.attendanceId,
        name: head.name,
        type: head.type,
        rawType: head.rawType,
        startDate: start,
        endDate: prev,
        days: count,
        status: head.status,
        description: head.description,
        applyDate: head.applyDate,
        externalId: '',
      });
    for (const date of dates.slice(1)) {
      if (date === nextBusinessDay(prev)) {
        prev = date;
        count++;
        continue;
      }
      flush();
      start = date;
      prev = date;
      count = 1;
    }
    flush();
  }
  records.sort(
    (a, b) =>
      a.attendanceId.localeCompare(b.attendanceId) ||
      a.startDate.localeCompare(b.startDate) ||
      a.type.localeCompare(b.type) ||
      a.status.localeCompare(b.status),
  );
  const used = new Set<string>();
  for (const r of records) {
    let id = `${STELLAR_LEAVE_SOURCE}:${r.attendanceId}:${r.startDate}:${r.type}`;
    if (used.has(id)) id = `${id}:${r.status.toLowerCase()}`;
    for (let n = 2; used.has(id); n++)
      id = `${STELLAR_LEAVE_SOURCE}:${r.attendanceId}:${r.startDate}:${r.type}:${r.status.toLowerCase()}:${n}`;
    used.add(id);
    r.externalId = id;
  }
  return records;
}

/** Parse, flag and merge a whole leave export. Throws `StellarCsvError` for a file of the wrong shape. */
export function parseStellarLeavesCsv(text: string): StellarLeaveParse {
  const parsed = parseStellarLeaveDays(text);
  const records = mergeLeaveDays(parsed.days);
  const users = new Map<string, { attendanceId: string; name: string }>();
  let from: string | null = null;
  let to: string | null = null;
  for (const d of parsed.days) {
    if (!users.has(d.attendanceId))
      users.set(d.attendanceId, { attendanceId: d.attendanceId, name: d.name });
    if (!from || d.date < from) from = d.date;
    if (!to || d.date > to) to = d.date;
  }
  return {
    records,
    users: [...users.values()],
    range: from && to ? { from, to } : null,
    rowsRead: parsed.rowsRead,
    skipped: parsed.skipped,
    warnings: parsed.warnings,
  };
}
