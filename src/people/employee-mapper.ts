import {
  internshipDueDate,
  nextDue,
  overdueAppraisals,
  type AppraisalOnRecord,
  type ScheduleEmployee,
} from '../appraisals/appraisal-schedule';
import type { EmployeeRow } from './employees.repository';
import { dateColumnToIso, tenureMonths } from './people-dates';
import type { EmployeeProfile } from './people.types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The lifecycle dates as the schedule reads them (0034). The anchor is the
 * stored probation start (the join date when none, except for an intern, who
 * has not started probation). The internship term starts at the end date
 * before the latest extension.
 */
export function scheduleFieldsOf(row: {
  joinDate: Date;
  status: EmployeeRow['status'];
  probationStartDate?: Date | null;
  internshipEndDate?: Date | null;
  events?: { fromValue: string | null }[];
}): ScheduleEmployee {
  const joinDate = dateColumnToIso(row.joinDate);
  const extendedFrom = row.events?.[0]?.fromValue ?? null;
  return {
    joinDate,
    status: row.status,
    probationStartDate: row.probationStartDate
      ? dateColumnToIso(row.probationStartDate)
      : null,
    internshipEndDate: row.internshipEndDate
      ? dateColumnToIso(row.internshipEndDate)
      : null,
    internshipTermStart:
      extendedFrom && DATE_ONLY.test(extendedFrom) ? extendedFrom : null,
  };
}

/** Row -> API profile. `today` is the Dhaka date, so tenure is computable without a clock in here. */
export function toProfile(row: EmployeeRow, today: string): EmployeeProfile {
  const joinDate = dateColumnToIso(row.joinDate);
  const exitDate = row.exitDate ? dateColumnToIso(row.exitDate) : null;
  const end = exitDate && exitDate < today ? exitDate : today;
  const confirmationDate = row.confirmationDate
    ? dateColumnToIso(row.confirmationDate)
    : null;
  // Older fixtures build rows without the relation; treat that as "no appraisals".
  const appraisals: AppraisalOnRecord[] = (row.appraisals ?? []).map((a) => ({
    type: a.cycle.type,
    dueDate: a.dueDate ? dateColumnToIso(a.dueDate) : null,
    periodEnd: dateColumnToIso(a.periodEnd ?? a.cycle.periodEnd),
  }));
  const schedule = scheduleFieldsOf(row);
  const overdue = overdueAppraisals(
    { ...schedule, confirmationDate, appraisals },
    today,
  ).map((d) => ({
    type: d.type,
    dueDate: d.dueDate,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    overdue: true,
  }));
  // A past confirmation is only overdue while nobody has launched it.
  const upcoming = nextDue(schedule, today).map((n) =>
    n.overdue
      ? {
          ...n,
          overdue: overdue.some(
            (o) => o.type === n.type && o.dueDate === n.dueDate,
          ),
        }
      : n,
  );
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    employeeCode: row.employeeCode,
    designation: row.designation,
    grade: row.grade,
    department: row.department,
    teamId: row.teamId,
    teamName: row.team?.name ?? null,
    managerId: row.managerId,
    managerName: row.manager?.fullName ?? null,
    joinDate,
    // An intern has not started probation; everyone else's anchor reads as the join date when unset.
    probationStartDate:
      row.status === 'INTERN'
        ? (schedule.probationStartDate ?? null)
        : (schedule.probationStartDate ?? joinDate),
    internshipEndDate:
      row.status === 'INTERN'
        ? internshipDueDate(schedule)
        : (schedule.internshipEndDate ?? null),
    confirmationDate,
    exitDate,
    status: row.status,
    tenureMonths: tenureMonths(joinDate, end),
    clickupUserId: row.clickupUserId,
    userId: row.userId,
    linked: { clickup: row.clickupUserId !== null, user: row.userId !== null },
    concernName: row.concernName,
    academicQualification: row.academicQualification,
    experienceBeforeJoiningMonths: row.experienceBeforeJoiningMonths,
    startingSalary: row.startingSalary,
    grossSalary: row.grossSalary,
    // A missed due date with no appraisal comes first: the chip reads "overdue since".
    nextAppraisal: overdue[0] ?? upcoming[0] ?? null,
    upcomingAppraisals: upcoming,
  };
}
