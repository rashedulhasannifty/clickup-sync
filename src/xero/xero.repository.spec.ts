import { XeroRepository } from './xero.repository';

function makePrisma() {
  const model = () => ({
    upsert: jest.fn((a) => a), deleteMany: jest.fn((a) => a), createMany: jest.fn((a) => a), update: jest.fn(), upsert2: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  });
  const prisma = {
    xeroInvoice: model(), xeroContact: model(), xeroCreditNote: model(), xeroBankTransaction: model(), xeroPayment: model(),
    xeroAttachment: model(),
    xeroSyncState: { upsert: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  return prisma;
}

describe('XeroRepository', () => {
  it('upserts invoices keyed on invoiceId in one transaction', async () => {
    const prisma = makePrisma();
    const repo = new XeroRepository(prisma as never);
    await repo.upsertInvoices([{ invoiceId: 'a' }, { invoiceId: 'b' }] as never);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.xeroInvoice.upsert).toHaveBeenCalledWith({ where: { invoiceId: 'a' }, create: { invoiceId: 'a' }, update: { invoiceId: 'a' } });
    expect(prisma.xeroInvoice.upsert).toHaveBeenCalledTimes(2);
  });

  it('skips the transaction for an empty batch', async () => {
    const prisma = makePrisma();
    await new XeroRepository(prisma as never).upsertContacts([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaceAttachments deletes the parent set, then inserts the new one atomically', async () => {
    const prisma = makePrisma();
    const rows = [{ attachmentId: 'x', parentType: 'invoice', parentId: 'p', fileName: 'a.pdf', mimeType: null, contentLength: null }];
    await new XeroRepository(prisma as never).replaceAttachments('p', rows);
    expect(prisma.xeroAttachment.deleteMany).toHaveBeenCalledWith({ where: { parentId: 'p' } });
    expect(prisma.xeroAttachment.createMany).toHaveBeenCalledWith({ data: rows, skipDuplicates: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('finishEntity keeps the old watermark when the run saw no records', async () => {
    const prisma = makePrisma();
    await new XeroRepository(prisma as never).finishEntity('invoices', null, 0);
    const arg = prisma.xeroSyncState.upsert.mock.calls[0][0];
    expect(arg.update).not.toHaveProperty('watermark');
    expect(arg.update).toMatchObject({ status: 'OK', recordsUpserted: 0 });
  });

  describe('attachment parents (the DB-driven attachment phase)', () => {
    const t = (iso: string) => new Date(iso);
    const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

    it('asks each parent table for flagged rows, oldest first then by id, bounded by take', async () => {
      const prisma = makePrisma();
      await new XeroRepository(prisma as never).attachmentParentsAfter(null, 50);
      expect(prisma.xeroInvoice.findMany).toHaveBeenCalledWith({
        where: { hasAttachments: true },
        orderBy: [{ updatedDateUtc: 'asc' }, { invoiceId: 'asc' }],
        take: 50,
        select: { invoiceId: true, updatedDateUtc: true },
      });
      expect(prisma.xeroCreditNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { hasAttachments: true }, orderBy: [{ updatedDateUtc: 'asc' }, { creditNoteId: 'asc' }], take: 50,
      }));
      expect(prisma.xeroBankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { hasAttachments: true }, orderBy: [{ updatedDateUtc: 'asc' }, { bankTransactionId: 'asc' }], take: 50,
      }));
    });

    it('a watermark alone means strictly newer; a watermark plus id is a keyset cursor for the next page', async () => {
      const prisma = makePrisma();
      const repo = new XeroRepository(prisma as never);
      await repo.attachmentParentsAfter({ updatedDateUtc: t('2026-09-10T00:00:00Z') }, 10);
      expect(prisma.xeroInvoice.findMany.mock.calls[0][0].where).toEqual({ hasAttachments: true, updatedDateUtc: { gt: t('2026-09-10T00:00:00Z') } });
      await repo.attachmentParentsAfter({ updatedDateUtc: t('2026-09-10T00:00:00Z'), id: ID(5) }, 10);
      expect(prisma.xeroCreditNote.findMany.mock.calls[1][0].where).toEqual({
        hasAttachments: true,
        OR: [{ updatedDateUtc: { gt: t('2026-09-10T00:00:00Z') } }, { updatedDateUtc: t('2026-09-10T00:00:00Z'), creditNoteId: { gt: ID(5) } }],
      });
    });

    it('merges the three tables into one global (updatedDateUtc, id) order and returns at most take', async () => {
      const prisma = makePrisma();
      prisma.xeroInvoice.findMany.mockResolvedValue([
        { invoiceId: ID(1), updatedDateUtc: t('2026-09-03T00:00:00Z') },
        { invoiceId: ID(9), updatedDateUtc: t('2026-09-05T00:00:00Z') },
      ]);
      prisma.xeroCreditNote.findMany.mockResolvedValue([{ creditNoteId: ID(4), updatedDateUtc: t('2026-09-01T00:00:00Z') }]);
      prisma.xeroBankTransaction.findMany.mockResolvedValue([
        { bankTransactionId: ID(2), updatedDateUtc: t('2026-09-03T00:00:00Z') },
        { bankTransactionId: ID(3), updatedDateUtc: t('2026-09-04T00:00:00Z') },
      ]);
      const rows = await new XeroRepository(prisma as never).attachmentParentsAfter(null, 4);
      expect(rows).toEqual([
        { parentType: 'creditNote', id: ID(4), updatedDateUtc: t('2026-09-01T00:00:00Z') },
        { parentType: 'invoice', id: ID(1), updatedDateUtc: t('2026-09-03T00:00:00Z') },
        { parentType: 'bankTransaction', id: ID(2), updatedDateUtc: t('2026-09-03T00:00:00Z') },
        { parentType: 'bankTransaction', id: ID(3), updatedDateUtc: t('2026-09-04T00:00:00Z') },
      ]);
    });

    it('advanceWatermark moves the watermark and progress mid-phase without marking the entity OK', async () => {
      const prisma = makePrisma();
      await new XeroRepository(prisma as never).advanceWatermark('attachments', t('2026-09-04T00:00:00Z'), 7);
      const arg = prisma.xeroSyncState.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({ entity: 'attachments' });
      expect(arg.update).toEqual({ watermark: t('2026-09-04T00:00:00Z'), recordsUpserted: 7 });
      expect(arg.create).toEqual({ entity: 'attachments', watermark: t('2026-09-04T00:00:00Z'), recordsUpserted: 7 });
    });
  });
});
