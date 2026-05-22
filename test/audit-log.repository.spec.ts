import { AuditLogRepository } from '../src/admin/audit-log.repository';

function makePrisma(over: Partial<Record<string, any>> = {}) {
  return {
    adminAuditLog: {
      create: jest.fn().mockResolvedValue({ id: BigInt(1) }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ...over,
  } as any;
}

describe('AuditLogRepository', () => {
  describe('create', () => {
    it('writes a row with all captured fields', async () => {
      const prisma = makePrisma();
      const repo = new AuditLogRepository(prisma);
      await repo.create({
        actor: 'rashedul',
        method: 'POST',
        path: '/admin/rates',
        routePattern: '/admin/rates',
        statusCode: 201,
        durationMs: 42,
        ip: '127.0.0.1',
        userAgent: 'jest',
        requestBody: { foo: 'bar' },
        errorMessage: null,
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor: 'rashedul',
          method: 'POST',
          path: '/admin/rates',
          routePattern: '/admin/rates',
          statusCode: 201,
          requestBody: { foo: 'bar' },
        }),
      });
    });

    it('allows null actor (no X-Admin-User header)', async () => {
      const prisma = makePrisma();
      await new AuditLogRepository(prisma).create({
        actor: null, method: 'DELETE', path: '/admin/rates/3',
        routePattern: '/admin/rates/:id', statusCode: 204, durationMs: 10,
        ip: null, userAgent: null, requestBody: null, errorMessage: null,
      });
      expect(prisma.adminAuditLog.create.mock.calls[0][0].data.actor).toBeNull();
    });
  });

  describe('findMany', () => {
    it('filters by actor and date range, paginates, returns { items, total }', async () => {
      const prisma = makePrisma();
      prisma.adminAuditLog.findMany.mockResolvedValue([
        { id: BigInt(7), occurredAt: new Date(), actor: 'rashedul', method: 'POST', path: '/admin/rates', routePattern: '/admin/rates', statusCode: 201, durationMs: 11, ip: null, userAgent: null, requestBody: null, errorMessage: null },
      ]);
      prisma.adminAuditLog.count.mockResolvedValue(1);
      const out = await new AuditLogRepository(prisma).findMany({
        actor: 'rashedul', routePattern: undefined,
        from: new Date('2026-05-01'), to: new Date('2026-05-31'),
        limit: 50, offset: 0,
      });
      expect(out.total).toBe(1);
      expect(out.items[0].id).toBe('7');
      const call = prisma.adminAuditLog.findMany.mock.calls[0][0];
      expect(call.where.actor).toBe('rashedul');
      expect(call.where.occurredAt).toEqual({ gte: new Date('2026-05-01'), lte: new Date('2026-05-31') });
      expect(call.take).toBe(50);
      expect(call.orderBy).toEqual({ occurredAt: 'desc' });
    });

    it('caps limit at 200', async () => {
      const prisma = makePrisma();
      await new AuditLogRepository(prisma).findMany({ limit: 9999, offset: 0 });
      expect(prisma.adminAuditLog.findMany.mock.calls[0][0].take).toBe(200);
    });
  });
});
