import {
  nextDue,
  overdueAppraisals,
  type AppraisalOnRecord,
} from '../appraisals/appraisal-schedule';
import type { EmployeeRow } from './employees.repository';
import { dateColumnToIso, tenureMonths } from './people-dates';
import type { EmployeeProfile } from './people.types';

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
  const overdue = overdueAppraisals(
    { joinDate, status: row.status, confirmationDate, appraisals },
    today,
  ).map((d) => ({
    type: d.type,
    dueDate: d.dueDate,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    overdue: true,
  }));
  // A past confirmation is only overdue while nobody has launched it.
  const upcoming = nextDue(joinDate, row.status, today).map((n) =>
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
