import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { XeroRepository } from '../src/xero/xero.repository';
import { XERO_CONNECTION_ID } from '../src/xero/xero-connection.repository';

/**
 * The one thing only a real database can answer: that `eraseAll()` empties every Xero
 * table in a single transaction and unlinks the organisation. The mocked unit spec proves
 * the ORDER of the statements; this proves they actually delete against live Postgres —
 * where a wrong delete order or a stray constraint would abort the whole transaction.
 *
 * Ordering, the busy refusal and the queue drain live in the colocated unit spec, where
 * call order can be asserted on mocks. Nothing here goes through HTTP.
 */
describe('Xero erase (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: XeroRepository;

  const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  beforeAll(async () => {
    // Safety fuse: this suite deletes every xero_* row with no filter. Against a dev or
    // prod database that destroys the real finance mirror. `npm run test:e2e` provisions
    // and targets an isolated `<db>_test` database (see test/run-e2e.js).
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Refusing to run e2e against a non-test database. Use `npm run test:e2e`.');
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    repo = app.get(XeroRepository);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('empties every synced table and unlinks the organisation', async () => {
    const now = new Date();

    // One row in each of the seven tables, plus a connected organisation.
    await prisma.xeroConnection.upsert({
      where: { id: XERO_CONNECTION_ID },
      create: { id: XERO_CONNECTION_ID, tenantId: 'tenant-old', tenantName: 'Demo Company', connectionId: 'conn-old', baseCurrency: 'USD', status: 'CONNECTED' },
      update: { tenantId: 'tenant-old', tenantName: 'Demo Company', connectionId: 'conn-old', baseCurrency: 'USD', status: 'CONNECTED' },
    });
    await prisma.xeroContact.create({
      data: { contactId: UUID(1), name: 'Acme', status: 'ACTIVE', updatedDateUtc: now, raw: {} },
    });
    await prisma.xeroInvoice.create({
      data: { invoiceId: UUID(2), type: 'ACCREC', status: 'AUTHORISED', currencyCode: 'USD', updatedDateUtc: now, lineItems: [], raw: {} },
    });
    await prisma.xeroCreditNote.create({
      data: { creditNoteId: UUID(3), type: 'ACCRECCREDIT', status: 'AUTHORISED', currencyCode: 'USD', updatedDateUtc: now, lineItems: [], raw: {} },
    });
    await prisma.xeroBankTransaction.create({
      data: { bankTransactionId: UUID(4), type: 'SPEND', status: 'AUTHORISED', currencyCode: 'USD', updatedDateUtc: now, lineItems: [], raw: {} },
    });
    await prisma.xeroPayment.create({
      data: { paymentId: UUID(5), paymentType: 'ACCRECPAYMENT', status: 'AUTHORISED', currencyCode: 'USD', updatedDateUtc: now, raw: {} },
    });
    await prisma.xeroAttachment.create({
      data: { attachmentId: UUID(6), parentType: 'invoice', parentId: UUID(2), fileName: 'receipt.pdf' },
    });
    await prisma.xeroSyncState.upsert({
      where: { entity: 'contacts' },
      create: { entity: 'contacts', status: 'OK', recordsUpserted: 1, watermark: now },
      update: { status: 'OK', recordsUpserted: 1, watermark: now },
    });

    await repo.eraseAll();

    expect(await prisma.xeroContact.count()).toBe(0);
    expect(await prisma.xeroInvoice.count()).toBe(0);
    expect(await prisma.xeroCreditNote.count()).toBe(0);
    expect(await prisma.xeroBankTransaction.count()).toBe(0);
    expect(await prisma.xeroPayment.count()).toBe(0);
    expect(await prisma.xeroAttachment.count()).toBe(0);
    expect(await prisma.xeroSyncState.count()).toBe(0);

    // The row survives (saveConnected upserts the fixed id), but carries no organisation —
    // which is what lets a DIFFERENT Xero org connect without hitting the different_org guard.
    const conn = await prisma.xeroConnection.findUnique({ where: { id: XERO_CONNECTION_ID } });
    expect(conn).not.toBeNull();
    expect(conn?.tenantId).toBeNull();
    expect(conn?.connectionId).toBeNull();
    expect(conn?.tenantName).toBeNull();
    expect(conn?.baseCurrency).toBeNull();
    expect(conn?.accessTokenEnc).toBeNull();
    expect(conn?.refreshTokenEnc).toBeNull();
    expect(conn?.status).toBe('DISCONNECTED');
  });
});
