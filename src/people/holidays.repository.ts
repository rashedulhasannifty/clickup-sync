import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  dateColumnToIso,
  isoToDateColumn,
  type Holidays,
} from './people-dates';

export interface HolidayRow {
  id: string;
  date: string;
  name: string;
  tentative: boolean;
}

const SELECT = { id: true, date: true, name: true, tentative: true } as const;

const toRow = (r: {
  id: string;
  date: Date;
  name: string;
  tentative: boolean;
}): HolidayRow => ({ ...r, date: dateColumnToIso(r.date) });

/** Owns every read and write of `holidays`. */
@Injectable()
export class HolidaysRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string, from: string, to: string): Promise<HolidayRow[]> {
    const rows = await this.prisma.holiday.findMany({
      where: {
        orgId,
        date: { gte: isoToDateColumn(from), lte: isoToDateColumn(to) },
      },
      select: SELECT,
      orderBy: { date: 'asc' },
    });
    return rows.map(toRow);
  }

  /** Date → name for [from, to], what the attendance and KPI maths take. */
  async map(orgId: string, from: string, to: string): Promise<Holidays> {
    const rows = await this.list(orgId, from, to);
    return new Map(rows.map((r) => [r.date, r.name]));
  }

  async findMany(orgId: string, ids: string[]): Promise<HolidayRow[]> {
    const rows = await this.prisma.holiday.findMany({
      where: { orgId, id: { in: ids } },
      select: SELECT,
    });
    return rows.map(toRow);
  }

  /** Inserts the dates; a date that is already a holiday is skipped. Returns how many were added. */
  async createMany(
    orgId: string,
    rows: { date: string; name: string; tentative: boolean }[],
    createdBy: string | null,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await this.prisma.holiday.createMany({
      data: rows.map((r) => ({
        orgId,
        date: isoToDateColumn(r.date),
        name: r.name,
        tentative: r.tentative,
        createdBy,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  async update(
    orgId: string,
    ids: string[],
    data: { name?: string; tentative?: boolean },
  ): Promise<number> {
    const res = await this.prisma.holiday.updateMany({
      where: { orgId, id: { in: ids } },
      data,
    });
    return res.count;
  }

  async delete(orgId: string, ids: string[]): Promise<number> {
    const res = await this.prisma.holiday.deleteMany({
      where: { orgId, id: { in: ids } },
    });
    return res.count;
  }
}
