import { nextDue } from '../appraisals/appraisal-schedule';
import type { EmployeeRow } from './employees.repository';
import { dateColumnToIso, tenureMonths } from './people-dates';
import type { EmployeeProfile } from './people.types';

/** Row -> API profile. `today` is the Dhaka date, so tenure is computable without a clock in here. */
export function toProfile(row: EmployeeRow, today: string): EmployeeProfile {
  const joinDate = dateColumnToIso(row.joinDate);
  const exitDate = row.exitDate ? dateColumnToIso(row.exitDate) : null;
  const end = exitDate && exitDate < today ? exitDate : today;
  const upcoming = nextDue(joinDate, row.status, today);
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
    confirmationDate: row.confirmationDate
      ? dateColumnToIso(row.confirmationDate)
      : null,
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
    nextAppraisal: upcoming[0] ?? null,
    upcomingAppraisals: upcoming,
  };
}
