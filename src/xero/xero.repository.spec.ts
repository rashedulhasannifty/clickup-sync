import { XeroRepository } from './xero.repository';

function makePrisma() {
  const model = () => ({ upsert: jest.fn((a) => a), deleteMany: jest.fn((a) => a), createMany: jest.fn((a) => a), update: jest.fn(), upsert2: jest.fn() });
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
});
