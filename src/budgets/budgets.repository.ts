import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

function mapBudget(r: {
  budgetId: bigint;
  client: string;
  monthlyAmountCents: bigint;
  currency: string;
  validFrom: Date;
  validTo: Date | null;
  notes: string | null;
  updatedAt: Date;
}) {
  return {
    id: r.budgetId.toString(),
    client: r.client,
    monthlyAmountCents: Number(r.monthlyAmountCents),
    currency: r.currency,
    validFrom: r.validFrom,
    validTo: r.validTo,
    notes: r.notes,
    updatedAt: r.updatedAt,
  };
}

@Injectable()
export class BudgetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 200);
    const skip = (page - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.prisma.clientBudget.findMany({
        orderBy: [{ client: 'asc' }, { validFrom: 'desc' }],
        take: safeLimit,
        skip,
      }),
      this.prisma.clientBudget.count(),
    ]);
    return { items: items.map(mapBudget), total, page, limit: safeLimit };
  }

  /** Every budget row, oldest-resolution-friendly order, for the status query. */
  async findAllRows() {
    const items = await this.prisma.clientBudget.findMany({
      orderBy: [{ client: 'asc' }, { validFrom: 'desc' }],
    });
    return items.map(mapBudget);
  }

  async findById(id: bigint) {
    const r = await this.prisma.clientBudget.findUnique({ where: { budgetId: id } });
    return r ? mapBudget(r) : null;
  }

  async create(data: {
    client: string;
    monthlyAmountCents: number;
    currency: string;
    validFrom: Date;
    validTo?: Date | null;
    notes?: string | null;
  }) {
    const r = await this.prisma.clientBudget.create({
      data: {
        client: data.client,
        monthlyAmountCents: BigInt(data.monthlyAmountCents),
        currency: data.currency,
        validFrom: data.validFrom,
        validTo: data.validTo ?? null,
        notes: data.notes ?? null,
      },
    });
    return mapBudget(r);
  }

  async update(
    id: bigint,
    data: {
      client?: string;
      monthlyAmountCents?: number;
      currency?: string;
      validFrom?: Date;
      validTo?: Date | null;
      notes?: string | null;
    },
  ) {
    const update: Record<string, unknown> = {};
    if (data.client !== undefined) update.client = data.client;
    if (data.monthlyAmountCents !== undefined) update.monthlyAmountCents = BigInt(data.monthlyAmountCents);
    if (data.currency !== undefined) update.currency = data.currency;
    if (data.validFrom !== undefined) update.validFrom = data.validFrom;
    if ('validTo' in data) update.validTo = data.validTo ?? null;
    if ('notes' in data) update.notes = data.notes ?? null;
    const r = await this.prisma.clientBudget.update({ where: { budgetId: id }, data: update });
    return mapBudget(r);
  }

  async remove(id: bigint) {
    await this.prisma.clientBudget.delete({ where: { budgetId: id } });
  }
}
