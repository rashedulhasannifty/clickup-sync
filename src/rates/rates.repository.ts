import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface RateRow { assigneeId: string; assigneeName?: string; assigneeEmail?: string; currency: string; hourlyRateCents: bigint; validFrom: Date; validTo: Date | null; }

function mapRate(r: { rateId: bigint; assigneeId: string; assigneeName: string | null; assigneeEmail: string | null; currency: string; hourlyRateCents: bigint; validFrom: Date; validTo: Date | null; updatedAt: Date }) {
  return { id: r.rateId.toString(), assigneeId: r.assigneeId, assigneeName: r.assigneeName, assigneeEmail: r.assigneeEmail, currency: r.currency, hourlyRateCents: Number(r.hourlyRateCents), validFrom: r.validFrom, validTo: r.validTo, updatedAt: r.updatedAt };
}

@Injectable()
export class RatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(row: RateRow) {
    return this.prisma.assigneeRate.upsert({
      where: { assigneeId_validFrom: { assigneeId: row.assigneeId, validFrom: row.validFrom } },
      create: row,
      update: { assigneeName: row.assigneeName, assigneeEmail: row.assigneeEmail, currency: row.currency, hourlyRateCents: row.hourlyRateCents, validTo: row.validTo },
    });
  }

  async findAll(page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    const skip = (page - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.prisma.assigneeRate.findMany({ orderBy: [{ assigneeId: 'asc' }, { validFrom: 'desc' }], take: safeLimit, skip }),
      this.prisma.assigneeRate.count(),
    ]);
    return { items: items.map(mapRate), total, page, limit: safeLimit };
  }

  async findById(id: bigint) {
    const r = await this.prisma.assigneeRate.findUnique({ where: { rateId: id } });
    return r ? mapRate(r) : null;
  }

  async create(data: { assigneeId: string; assigneeName?: string; assigneeEmail?: string; currency: string; hourlyRateCents: number; validFrom: Date; validTo?: Date | null }) {
    const r = await this.prisma.assigneeRate.create({
      data: { assigneeId: data.assigneeId, assigneeName: data.assigneeName, assigneeEmail: data.assigneeEmail, currency: data.currency, hourlyRateCents: BigInt(data.hourlyRateCents), validFrom: data.validFrom, validTo: data.validTo ?? null },
    });
    return mapRate(r);
  }

  async update(id: bigint, data: { currency?: string; hourlyRateCents?: number; validFrom?: Date; validTo?: Date | null }) {
    const update: Record<string, unknown> = {};
    if (data.currency !== undefined) update.currency = data.currency;
    if (data.hourlyRateCents !== undefined) update.hourlyRateCents = BigInt(data.hourlyRateCents);
    if (data.validFrom !== undefined) update.validFrom = data.validFrom;
    if ('validTo' in data) update.validTo = data.validTo ?? null;
    const r = await this.prisma.assigneeRate.update({ where: { rateId: id }, data: update });
    return mapRate(r);
  }

  async remove(id: bigint) {
    await this.prisma.assigneeRate.delete({ where: { rateId: id } });
  }
}
