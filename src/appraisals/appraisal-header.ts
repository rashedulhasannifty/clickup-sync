import { tenureMonths } from '../people/people-dates';
import type { EmploymentEventTypeValue } from '../people/people.types';
import type { FormHeader } from './appraisals.types';

/** The employee fields the header reads. Dates are `YYYY-MM-DD`. */
export interface HeaderEmployee {
  fullName: string;
  concernName: string | null;
  designation: string;
  department: string | null;
  joinDate: string;
  exitDate: string | null;
  academicQualification: string | null;
  experienceBeforeJoiningMonths: number | null;
  startingSalary: number | null;
  grossSalary: number | null;
}

export interface HeaderEvent {
  type: EmploymentEventTypeValue;
  effectiveDate: string;
  fromValue: string | null;
  toValue: string | null;
}

const WHOLE = /^\d+$/;

/** Latest first: by effective date, the input order breaking ties (callers pass newest-first rows). */
function latest(events: HeaderEvent[], type: EmploymentEventTypeValue) {
  let best: HeaderEvent | null = null;
  for (const e of events) {
    if (e.type !== type) continue;
    if (!best || e.effectiveDate > best.effectiveDate) best = e;
  }
  return best;
}

/**
 * The form's header block. Pure: `today` is the Dhaka date of capture. Last
 * increment amount and last promotion date come from the employment timeline
 * (INCREMENT and PROMOTED events), never typed. An INCREMENT whose amounts are
 * not whole numbers (hand-edited data) gives no amount rather than a guess.
 */
export function buildFormHeader(args: {
  employee: HeaderEmployee;
  events: HeaderEvent[];
  companyName: string;
  today: string;
  capturedAt: string;
}): FormHeader {
  const { employee: e, events, today } = args;
  const end = e.exitDate && e.exitDate < today ? e.exitDate : today;
  const inCompany = tenureMonths(e.joinDate, end);

  const increment = latest(
    events.filter(
      (x) =>
        x.type === 'INCREMENT' &&
        WHOLE.test(x.fromValue ?? '') &&
        WHOLE.test(x.toValue ?? ''),
    ),
    'INCREMENT',
  );
  const promotion = latest(events, 'PROMOTED');

  return {
    capturedAt: args.capturedAt,
    name: e.fullName,
    concernName: e.concernName,
    designation: e.designation,
    department: e.department,
    joinDate: e.joinDate,
    academicQualification: e.academicQualification,
    companyName: args.companyName,
    experienceInCompanyMonths: inCompany,
    experienceBeforeJoiningMonths: e.experienceBeforeJoiningMonths,
    totalExperienceMonths:
      e.experienceBeforeJoiningMonths === null
        ? null
        : e.experienceBeforeJoiningMonths + inCompany,
    startingSalary: e.startingSalary,
    grossSalary: e.grossSalary,
    lastIncrementAmount: increment
      ? Number(increment.toValue) - Number(increment.fromValue)
      : null,
    lastIncrementDate: increment?.effectiveDate ?? null,
    lastPromotionDate: promotion?.effectiveDate ?? null,
  };
}

/** "3 yrs 4 mos", "11 mos", "0 mos". */
export function monthsText(m: number | null): string {
  if (m === null) return '—';
  const y = Math.floor(m / 12);
  const r = m % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} yr${y === 1 ? '' : 's'}`);
  if (r > 0 || y === 0) parts.push(`${r} mo${r === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Whole taka with thousands separators: "BDT 85,000". */
export function takaText(n: number | null): string {
  if (n === null) return '—';
  return `BDT ${n.toLocaleString('en-US')}`;
}
