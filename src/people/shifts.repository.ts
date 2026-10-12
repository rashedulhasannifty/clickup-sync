import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { isoToDateColumn } from './people-dates';

export interface ShiftWrite {
  name?: string;
  startMinutes?: number;
  endMinutes?: number;
  graceMinutes?: number;
  trackPunctuality?: boolean;
}

const SHIFT_SELECT = {
  id: true,
  name: true,
  startMinutes: true,
  endMinutes: true,
  graceMinutes: true,
  trackPunctuality: true,
  _count: { select: { employees: true } },
} as const;

/** Owns every write to `work_shifts` and to `employees.shift_id` in bulk. */
@Injectable()
export class ShiftsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(orgId: string) {
    return this.prisma.workShift.findMany({
      where: { orgId },
      select: SHIFT_SELECT,
      orderBy: [{ startMinutes: 'asc' }, { name: 'asc' }],
    });
  }

  find(orgId: string, id: string) {
    return this.prisma.workShift.findFirst({
      where: { id, orgId },
      select: SHIFT_SELECT,
    });
  }

  create(
    orgId: string,
    data: Required<Pick<ShiftWrite, 'name' | 'startMinutes' | 'endMinutes'>> &
      ShiftWrite,
  ) {
    return this.prisma.workShift.create({
      data: { orgId, ...data },
      select: SHIFT_SELECT,
    });
  }

  update(id: string, data: ShiftWrite) {
    return this.prisma.workShift.update({
      where: { id },
      data,
      select: SHIFT_SELECT,
    });
  }

  /** Employees on it fall back to the default (FK ON DELETE SET NULL). */
  async delete(id: string): Promise<void> {
    await this.prisma.workShift.delete({ where: { id } });
  }

  /** How many of `ids` are employees of this org. */
  countEmployeesInOrg(orgId: string, ids: string[]): Promise<number> {
    return this.prisma.employee.count({ where: { orgId, id: { in: ids } } });
  }

  /** Bulk (re)assignment in one transaction; every id was checked against the org first. */
  async assign(
    orgId: string,
    assignments: { employeeId: string; shiftId: string | null }[],
  ): Promise<number> {
    const results = await this.prisma.$transaction(
      assignments.map((a) =>
        this.prisma.employee.updateMany({
          where: { id: a.employeeId, orgId, status: { not: 'EXITED' } },
          data: { shiftId: a.shiftId },
        }),
      ),
    );
    return results.reduce((n, r) => n + r.count, 0);
  }

  /** Not-exited employees with their real (imported) first-ins in [from, to], for suggestions. */
  employeesWithRealFirstIns(orgId: string, from: string, to: string) {
    return this.prisma.employee.findMany({
      where: { orgId, status: { not: 'EXITED' } },
      select: {
        id: true,
        fullName: true,
        shiftId: true,
        attendances: {
          where: {
            source: { not: 'DUMMY' },
            firstIn: { not: null },
            date: { gte: isoToDateColumn(from), lte: isoToDateColumn(to) },
          },
          select: { date: true, firstIn: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });
  }
}
