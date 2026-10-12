import { percentText } from '../../appraisals/appraisal-score';
import { gradeFor } from '../../appraisals/appraisal-score';
import type {
  AppraisalActionValue,
  AppraisalTypeValue,
  FormGrade,
} from '../../appraisals/appraisals.types';

/**
 * Turns one row of a past-records sheet (or the "Add past record" dialog) into
 * a typed record. Pure and shared by the import and the per-employee editor,
 * so both routes read a row the same way. Every problem is a field error, never
 * an exception: one bad cell must not hide the other rows' errors.
 *
 * Messages never contain a salary figure (they can reach the audit log as a
 * 400's message).
 */

/** The event types a past record can be. Exits go through offboarding, never here. */
export type PastEventType =
  | 'JOINED'
  | 'JOINED_AS_INTERN'
  | 'PROBATION_STARTED'
  | 'CONFIRMED'
  | 'PROMOTED'
  | 'DESIGNATION_CHANGED'
  | 'TRANSFERRED'
  | 'INCREMENT';

export type PastRecordKind = PastEventType | 'APPRAISAL';

/** The human label HR types (and the template's dropdown offers), per record kind. */
export const RECORD_LABEL: Record<PastRecordKind, string> = {
  JOINED: 'Joined',
  JOINED_AS_INTERN: 'Joined as intern',
  PROBATION_STARTED: 'Moved to probation',
  CONFIRMED: 'Confirmed',
  PROMOTED: 'Promotion',
  DESIGNATION_CHANGED: 'Designation change',
  TRANSFERRED: 'Transfer',
  INCREMENT: 'Increment',
  APPRAISAL: 'Appraisal',
};

export const PAST_RECORD_KINDS = Object.keys(RECORD_LABEL) as PastRecordKind[];

export const APPRAISAL_TYPE_LABEL: Record<AppraisalTypeValue, string> = {
  YEARLY: 'Yearly',
  HALF_YEARLY: 'Half-yearly',
  CONFIRMATION: 'Confirmation',
  INTERNSHIP: 'Internship review',
};

export const ACTION_LABEL: Record<AppraisalActionValue, string> = {
  CONFIRM: 'Confirm',
  INCREMENT: 'Increment',
  PROMOTION: 'Promotion',
  TERMINATION: 'Termination',
  DISMISSAL: 'Dismissal',
  TRAINING_TRANSFER: 'Training/Transfer',
};

/** Lower-cased, punctuation-free, single-spaced: "Moved-to  Probation" -> "moved to probation". */
const squash = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[_\-/.,:;()&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const KIND_ALIASES: Record<string, PastRecordKind> = {
  joined: 'JOINED',
  join: 'JOINED',
  joining: 'JOINED',
  'joined as intern': 'JOINED_AS_INTERN',
  'joined intern': 'JOINED_AS_INTERN',
  'intern joined': 'JOINED_AS_INTERN',
  'moved to probation': 'PROBATION_STARTED',
  'probation started': 'PROBATION_STARTED',
  'probation start': 'PROBATION_STARTED',
  probation: 'PROBATION_STARTED',
  confirmed: 'CONFIRMED',
  confirmation: 'CONFIRMED',
  permanent: 'CONFIRMED',
  promotion: 'PROMOTED',
  promoted: 'PROMOTED',
  'designation change': 'DESIGNATION_CHANGED',
  'designation changed': 'DESIGNATION_CHANGED',
  transfer: 'TRANSFERRED',
  transferred: 'TRANSFERRED',
  increment: 'INCREMENT',
  'salary increment': 'INCREMENT',
  appraisal: 'APPRAISAL',
  'past appraisal': 'APPRAISAL',
};

/** Labels that name an exit: refused with a pointer to offboarding. */
const EXIT_WORDS = new Set([
  'notice',
  'notice given',
  'resigned',
  'resignation',
  'exit',
  'exited',
  'left',
  'terminated',
  'termination',
]);

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

/** The text of a cell: trimmed string, or null when empty. Numbers become their decimal text. */
export function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** A record label (case-insensitive, a few common spellings) or the enum value itself. */
export function parseRecordKind(v: unknown): Parsed<PastRecordKind> {
  const t = cellText(v);
  if (t === null) return fail('Record type is missing');
  if ((PAST_RECORD_KINDS as string[]).includes(t)) return ok(t as PastRecordKind);
  const key = squash(t);
  const kind = KIND_ALIASES[key];
  if (kind) return ok(kind);
  if (EXIT_WORDS.has(key))
    return fail(
      'Notice and exits are not past records: use Start offboarding on the employee page',
    );
  return fail(
    `Unknown record type "${t}". Use one of: ${PAST_RECORD_KINDS.map((k) => RECORD_LABEL[k]).join(', ')}`,
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A real calendar date as `YYYY-MM-DD`, or null (31 Feb, month 13, ...). */
function calendarDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Excel's day 0 is 1899-12-30 (this absorbs Excel's phantom 29 Feb 1900 for every real date). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  const iso = new Date(ms).toISOString().slice(0, 10);
  return iso >= '1900-03-01' ? iso : null;
}

/**
 * `YYYY-MM-DD`, `DD/MM/YYYY` (also `-` or `.` separated, one-digit day or
 * month allowed), an ISO timestamp (its date part), or an Excel serial day
 * number. Day-first, never month-first: 03/04/2024 is 3 April.
 */
export function parseDate(v: unknown, field = 'Date'): Parsed<string> {
  if (typeof v === 'number') {
    const iso = excelSerialToIso(v);
    return iso ? ok(iso) : fail(`${field} is not a date`);
  }
  const t = cellText(v);
  if (t === null) return fail(`${field} is missing`);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  if (m) {
    const iso = calendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? ok(iso) : fail(`${field} "${t}" is not a real date`);
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) {
    const iso = calendarDate(Number(m[3]), Number(m[2]), Number(m[1]));
    return iso ? ok(iso) : fail(`${field} "${t}" is not a real date`);
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const iso = excelSerialToIso(Number(t));
    if (iso) return ok(iso);
  }
  return fail(`${field} "${t}" is not a date: use YYYY-MM-DD or DD/MM/YYYY`);
}

/** A number cell: "1,25,000", "BDT 50000", "50000 tk", 50000. Null when empty. */
function numberOf(v: unknown): number | null | 'bad' {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'bad';
  const t = cellText(v);
  if (t === null) return null;
  const cleaned = t
    .replace(/^(bdt|tk|taka|৳)\s*/i, '')
    .replace(/\s*(bdt|tk|taka|৳|\/-)$/i, '')
    .replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return 'bad';
  return Number(cleaned);
}

/** A gross salary: a positive whole number of taka. Null when empty. */
export function parseMoney(v: unknown, field: string): Parsed<number | null> {
  const n = numberOf(v);
  if (n === null) return ok(null);
  if (n === 'bad') return fail(`${field} is not a number`);
  if (!Number.isInteger(n)) return fail(`${field} must be whole taka`);
  if (n <= 0) return fail(`${field} must be more than zero`);
  return ok(n);
}

/** "12%", "12.5", 12. Null when empty. */
export function parsePercent(v: unknown, field: string): Parsed<number | null> {
  const t = typeof v === 'number' ? String(v) : cellText(v);
  if (t === null) return ok(null);
  const m = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(t.replace(/\s+/g, ''));
  if (!m) return fail(`${field} is not a percentage`);
  const n = Number(m[1]);
  if (n <= 0) return fail(`${field} must be more than zero`);
  if (n > 500) return fail(`${field} is too large to be an increment percentage`);
  return ok(n);
}

export function parseMarks(v: unknown): Parsed<number | null> {
  const n = numberOf(v);
  if (n === null) return ok(null);
  if (n === 'bad') return fail('Marks is not a number');
  if (n < 0 || n > 100) return fail('Marks must be between 0 and 100');
  return ok(n);
}

export function parseGrade(v: unknown): Parsed<FormGrade | null> {
  const t = cellText(v);
  if (t === null) return ok(null);
  const g = t.toUpperCase();
  return /^[A-F]$/.test(g)
    ? ok(g as FormGrade)
    : fail(`Grade "${t}" must be one of A, B, C, D, E, F`);
}

const APPRAISAL_TYPE_ALIASES: Record<string, AppraisalTypeValue> = {
  yearly: 'YEARLY',
  annual: 'YEARLY',
  'half yearly': 'HALF_YEARLY',
  halfyearly: 'HALF_YEARLY',
  'half year': 'HALF_YEARLY',
  confirmation: 'CONFIRMATION',
  'internship review': 'INTERNSHIP',
  internship: 'INTERNSHIP',
};

/** Yearly / Half-yearly / Confirmation / Internship review; empty is Yearly. */
export function parseAppraisalType(v: unknown): Parsed<AppraisalTypeValue> {
  const t = cellText(v);
  if (t === null) return ok('YEARLY');
  if (t in APPRAISAL_TYPE_LABEL) return ok(t as AppraisalTypeValue);
  const type = APPRAISAL_TYPE_ALIASES[squash(t)];
  return type
    ? ok(type)
    : fail(
        `Appraisal type "${t}" must be one of: ${Object.values(APPRAISAL_TYPE_LABEL).join(', ')}`,
      );
}

const ACTION_ALIASES: Record<string, AppraisalActionValue> = {
  confirm: 'CONFIRM',
  confirmation: 'CONFIRM',
  confirmed: 'CONFIRM',
  increment: 'INCREMENT',
  promotion: 'PROMOTION',
  promote: 'PROMOTION',
  promoted: 'PROMOTION',
  termination: 'TERMINATION',
  terminate: 'TERMINATION',
  dismissal: 'DISMISSAL',
  dismiss: 'DISMISSAL',
  training: 'TRAINING_TRANSFER',
  transfer: 'TRAINING_TRANSFER',
  'training transfer': 'TRAINING_TRANSFER',
};

/** "Increment, Promotion" (comma or semicolon separated); an array of labels also works. */
export function parseActions(v: unknown): Parsed<AppraisalActionValue[]> {
  const parts = Array.isArray(v)
    ? v.map((x) => cellText(x)).filter((x): x is string => x !== null)
    : (cellText(v) ?? '')
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out: AppraisalActionValue[] = [];
  for (const p of parts) {
    const a =
      p in ACTION_LABEL ? (p as AppraisalActionValue) : ACTION_ALIASES[squash(p)];
    if (!a)
      return fail(
        `Unknown action "${p}". Use: ${Object.values(ACTION_LABEL).join(', ')}`,
      );
    if (!out.includes(a)) out.push(a);
  }
  return ok(out);
}

/** What a row can carry. Every field is loose: the normalizer does the checking. */
export interface PastRecordRowInput {
  /** The sheet's own row number, for messages. */
  row?: number;
  /** Email or employee code. */
  employee?: unknown;
  record?: unknown;
  date?: unknown;
  from?: unknown;
  to?: unknown;
  /** Increment %, or (above 100) the new gross when `to` is empty. */
  amount?: unknown;
  grade?: unknown;
  marks?: unknown;
  appraisalType?: unknown;
  actions?: unknown;
  /** Appraisal: the due date it was for (optional). */
  dueDate?: unknown;
  /** Appraisal: the outcome in a few words (optional). */
  outcome?: unknown;
  notes?: unknown;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface PastEventInput {
  kind: 'event';
  type: PastEventType;
  date: string;
  /** Raw text: a designation, a team name (TRANSFERRED, resolved later), or a gross (INCREMENT). */
  fromValue: string | null;
  toValue: string | null;
  notes: string | null;
}

export interface PastAppraisalInput {
  kind: 'appraisal';
  type: AppraisalTypeValue;
  conductedOn: string;
  dueDate: string | null;
  marks: number | null;
  grade: FormGrade | null;
  outcome: string | null;
  actions: AppraisalActionValue[];
  notes: string | null;
}

export type PastRecordInput = PastEventInput | PastAppraisalInput;

export type EmployeeRef = { email: string } | { code: string };

/** Email (has an @, matched lower-cased) or employee code (matched case-insensitively). */
export function parseEmployeeRef(v: unknown): Parsed<EmployeeRef> {
  const t = cellText(v);
  if (t === null) return fail('Employee (email or employee code) is missing');
  return t.includes('@') ? ok({ email: t.toLowerCase() }) : ok({ code: t });
}

const MAX_TEXT = 200;
const MAX_NOTES = 2000;

function text(
  v: unknown,
  field: string,
  max: number,
  errors: FieldError[],
): string | null {
  const t = cellText(v);
  if (t !== null && t.length > max)
    errors.push({ field, message: `${field} is longer than ${max} characters` });
  return t;
}

/** Increment: `from`/`to` are gross salaries; `amount` the percent (or, over 100, the new gross). */
function incrementValues(
  row: PastRecordRowInput,
  errors: FieldError[],
): { from: number | null; to: number | null; percent: number | null } {
  const from = parseMoney(row.from, 'Old gross (from)');
  let to = parseMoney(row.to, 'New gross (to)');
  let percent: Parsed<number | null> = ok(null);
  const amount = numberOf(row.amount);
  const amountIsPercent =
    typeof row.amount === 'string' && row.amount.includes('%');
  if (amount !== null && amount !== 'bad' && !amountIsPercent && amount > 100) {
    // A gross salary in the amount column: the new gross, when `to` is empty.
    if (to.ok && to.value === null)
      to = parseMoney(row.amount, 'New gross (amount)');
    else
      errors.push({
        field: 'amount',
        message:
          'Amount is the increment percentage when the new gross is in "to"',
      });
  } else {
    percent = parsePercent(row.amount, 'Increment %');
  }
  for (const [field, p] of [
    ['from', from],
    ['to', to],
    ['amount', percent],
  ] as const)
    if (!p.ok) errors.push({ field, message: p.error });
  let f = from.ok ? from.value : null;
  let t = to.ok ? to.value : null;
  const pct = percent.ok ? percent.value : null;
  if (!from.ok || !to.ok || !percent.ok) return { from: f, to: t, percent: pct };
  if (t === null && f !== null && pct !== null)
    t = Math.round(f * (1 + pct / 100));
  if (f === null && t !== null && pct !== null)
    f = Math.round(t / (1 + pct / 100));
  if (t === null) {
    errors.push({
      field: 'to',
      message:
        'An increment needs the new gross salary (to), or the old gross (from) and the increment %',
    });
    return { from: f, to: t, percent: pct };
  }
  if (f !== null && t <= f)
    errors.push({
      field: 'to',
      message: 'The new gross must be higher than the old gross',
    });
  const computed =
    pct ?? (f !== null && f > 0 ? ((t - f) / f) * 100 : null);
  return { from: f, to: t, percent: computed };
}

/**
 * One row -> a typed record and who it is for, or the field errors. Team names
 * stay names here (the caller resolves them against the org); increments come
 * out as whole-taka strings with the percent in the notes, as an approved
 * appraisal writes them.
 */
export function normalizeRow(
  row: PastRecordRowInput,
  opts: { requireEmployee: boolean } = { requireEmployee: true },
):
  | { ok: true; employee: EmployeeRef | null; record: PastRecordInput }
  | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  let employee: EmployeeRef | null = null;
  if (opts.requireEmployee) {
    const ref = parseEmployeeRef(row.employee);
    if (ref.ok) employee = ref.value;
    else errors.push({ field: 'employee', message: ref.error });
  }
  const kind = parseRecordKind(row.record);
  if (!kind.ok) {
    errors.push({ field: 'record', message: kind.error });
    return { ok: false, errors };
  }
  const date = parseDate(row.date, 'Date');
  if (!date.ok) errors.push({ field: 'date', message: date.error });
  const notes = text(row.notes, 'Notes', MAX_NOTES, errors);

  if (kind.value === 'APPRAISAL') {
    const type = parseAppraisalType(row.appraisalType);
    const marks = parseMarks(row.marks);
    const grade = parseGrade(row.grade);
    const actions = parseActions(row.actions);
    const due =
      cellText(row.dueDate) === null && typeof row.dueDate !== 'number'
        ? ok<string | null>(null)
        : parseDate(row.dueDate, 'Due date');
    const outcome = text(row.outcome, 'Outcome', MAX_NOTES, errors);
    for (const [field, p] of [
      ['appraisalType', type],
      ['marks', marks],
      ['grade', grade],
      ['actions', actions],
      ['dueDate', due],
    ] as const)
      if (!p.ok) errors.push({ field, message: p.error });
    if (errors.length > 0 || !date.ok) return { ok: false, errors };
    const m = marks.ok ? marks.value : null;
    const g = (grade.ok ? grade.value : null) ?? (m !== null ? gradeFor(m) : null);
    return {
      ok: true,
      employee,
      record: {
        kind: 'appraisal',
        type: type.ok ? type.value : 'YEARLY',
        conductedOn: date.value,
        dueDate: due.ok ? due.value : null,
        marks: m,
        grade: g,
        outcome,
        actions: actions.ok ? actions.value : [],
        notes,
      },
    };
  }

  const type = kind.value;
  let fromValue: string | null = null;
  let toValue: string | null = null;
  let eventNotes = notes;
  switch (type) {
    case 'INCREMENT': {
      const inc = incrementValues(row, errors);
      fromValue = inc.from !== null ? String(inc.from) : null;
      toValue = inc.to !== null ? String(inc.to) : null;
      if (inc.percent !== null)
        eventNotes = [percentText(inc.percent), notes].filter(Boolean).join(' · ');
      break;
    }
    case 'PROMOTED':
    case 'DESIGNATION_CHANGED':
    case 'TRANSFERRED': {
      fromValue = text(row.from, 'From', MAX_TEXT, errors);
      toValue = text(row.to, 'To', MAX_TEXT, errors);
      if (toValue === null)
        errors.push({
          field: 'to',
          message:
            type === 'TRANSFERRED'
              ? 'A transfer needs the new team name (to)'
              : 'A promotion or designation change needs the new designation (to)',
        });
      break;
    }
    case 'JOINED':
    case 'JOINED_AS_INTERN':
      // Optional: the designation they joined as ("Joined as Senior Software Engineer").
      toValue = text(row.to, 'Joined as', MAX_TEXT, errors);
      break;
    default:
      // Moved to probation, confirmed: the date is the record.
      break;
  }
  if (type !== 'INCREMENT' && cellText(row.amount) !== null)
    errors.push({
      field: 'amount',
      message: 'Amount is only used on Increment rows',
    });
  if (errors.length > 0 || !date.ok) return { ok: false, errors };
  return {
    ok: true,
    employee,
    record: {
      kind: 'event',
      type,
      date: date.value,
      fromValue,
      toValue,
      notes: eventNotes,
    },
  };
}
