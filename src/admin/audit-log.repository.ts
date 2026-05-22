import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface AuditLogCreateInput {
  actor: string | null;
  method: string;
  path: string;
  routePattern: string | null;
  statusCode: number;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  requestBody: unknown;
  errorMessage: string | null;
}

export interface AuditLogFindManyInput {
  actor?: string;
  routePattern?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: AuditLogCreateInput) {
    return this.prisma.adminAuditLog.create({
      data: {
        actor: input.actor,
        method: input.method,
        path: input.path,
        routePattern: input.routePattern,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        ip: input.ip,
        userAgent: input.userAgent,
        requestBody: input.requestBody as any,
        errorMessage: input.errorMessage,
      },
    });
  }

  async findMany(input: AuditLogFindManyInput) {
    const limit = Math.min(input.limit, 200);
    const where: any = {};
    if (input.actor) where.actor = input.actor;
    if (input.routePattern) where.routePattern = input.routePattern;
    if (input.from || input.to) {
      where.occurredAt = {};
      if (input.from) where.occurredAt.gte = input.from;
      if (input.to) where.occurredAt.lte = input.to;
    }
    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: limit,
        skip: input.offset,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({ ...r, id: r.id.toString() })),
      total,
    };
  }
}
