import { XeroSyncService } from './xero-sync.service';
import { XeroApiError, XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';

const U = (iso: string) => `/Date(${Date.parse(iso)}+0000)/`;
const inv = (id: string, updated: string, extra: Record<string, unknown> = {}) => ({
  InvoiceID: id, Type: 'ACCREC', Status: 'AUTHORISED', UpdatedDateUTC: U(updated), ...extra,
});

async function* gen(pages: unknown[][]) {
  for (const p of pages) yield p;
}

function setup(pagesByPath: Record<string, unknown[][] | Error> = {}, watermark: Date | null = null) {
  const client = {
    beginRun: jest.fn(),
    pages: jest.fn((path: string, _key: string, _opts: { params?: Record<string, string>; modifiedSince?: Date | null }) => {
      const v = pagesByPath[path];
      if (v instanceof Error) {
        // eslint-disable-next-line require-yield -- this generator's only purpose is to reject on iteration
        return (async function* () {
          throw v;
        })();
      }
      return gen(v ?? []);
    }),
    get: jest.fn().mockResolvedValue({ Attachments: [{ AttachmentID: 'att-1', FileName: 'SOW.pdf' }] }),
  };
  const repo = {
    getSyncState: jest.fn().mockResolvedValue(watermark ? { watermark } : null),
    startEntity: jest.fn(), recordProgress: jest.fn(), finishEntity: jest.fn(), failEntity: jest.fn(),
    upsertContacts: jest.fn(), upsertInvoices: jest.fn(), upsertCreditNotes: jest.fn(), upsertBankTransactions: jest.fn(),
    upsertPayments: jest.fn(), replaceAttachments: jest.fn(), openInvoiceIds: jest.fn().mockResolvedValue([]),
  };
  return { svc: new XeroSyncService(client as never, repo as never), client, repo };
}

describe('XeroSyncService.runSync', () => {
  it('runs every entity in order with the stored watermark as If-Modified-Since', async () => {
    const wm = new Date('2026-09-01T00:00:00Z');
    const { svc, client } = setup({}, wm);
    await svc.runSync();
    expect(client.beginRun).toHaveBeenCalled();
    expect(client.pages.mock.calls.map((c) => c[0])).toEqual(['/Contacts', '/Invoices', '/CreditNotes', '/BankTransactions', '/Payments']);
    for (const call of client.pages.mock.calls) expect(call[2].modifiedSince).toEqual(wm);
  });

  it('a full run ignores the watermark', async () => {
    const { svc, client } = setup({}, new Date('2026-09-01T00:00:00Z'));
    await svc.runSync({ full: true });
    for (const call of client.pages.mock.calls) expect(call[2].modifiedSince).toBeNull();
  });

  it('advances the watermark to the newest UpdatedDateUTC seen across pages', async () => {
    const { svc, repo } = setup({
      '/Invoices': [
        [inv('11111111-1111-4111-8111-111111111111', '2026-09-10T00:00:00Z')],
        [inv('22222222-2222-4222-8222-222222222222', '2026-09-12T08:00:00Z')],
      ],
    });
    await svc.runSync();
    expect(repo.upsertInvoices).toHaveBeenCalledTimes(2);
    expect(repo.finishEntity).toHaveBeenCalledWith('invoices', new Date('2026-09-12T08:00:00Z'), 2);
  });

  it('fetches attachment lists only for records flagged HasAttachments', async () => {
    const { svc, client, repo } = setup({
      '/Invoices': [[
        inv('11111111-1111-4111-8111-111111111111', '2026-09-10T00:00:00Z', { HasAttachments: true }),
        inv('22222222-2222-4222-8222-222222222222', '2026-09-10T00:00:00Z'),
      ]],
    });
    const res = await svc.runSync();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/Invoices/11111111-1111-4111-8111-111111111111/Attachments');
    expect(repo.replaceAttachments).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', [
      expect.objectContaining({ attachmentId: 'att-1', parentType: 'invoice', fileName: 'SOW.pdf' }),
    ]);
    expect(res.attachmentsFetched).toBe(1);
    // The Settings "Attachment lists" row must exist on a healthy run, not only after a failure.
    expect(repo.startEntity).toHaveBeenCalledWith('attachments');
    expect(repo.finishEntity).toHaveBeenCalledWith('attachments', null, 1);
  });

  it('stops cleanly on the day budget: marks RATE_LIMITED, keeps the watermark, skips later entities', async () => {
    const { svc, client, repo } = setup({ '/Invoices': new XeroRateBudgetExhaustedError(420) });
    const res = await svc.runSync();
    expect(res.stopped).toBe('rate_limited');
    expect(repo.failEntity).toHaveBeenCalledWith('invoices', 'RATE_LIMITED', expect.any(String));
    expect(repo.finishEntity).not.toHaveBeenCalledWith('invoices', expect.anything(), expect.anything());
    expect(client.pages.mock.calls.map((c) => c[0])).toEqual(['/Contacts', '/Invoices']);
  });

  it('stops cleanly when Xero needs reconnecting', async () => {
    const { svc, repo } = setup({ '/Contacts': new XeroReconnectRequiredError() });
    await expect(svc.runSync()).resolves.toMatchObject({ stopped: 'reconnect' });
    expect(repo.failEntity).toHaveBeenCalledWith('contacts', 'NEEDS_RECONNECT', expect.any(String));
  });

  it('marks other failures FAILED and rethrows so BullMQ retries', async () => {
    const { svc, repo } = setup({ '/Payments': new XeroApiError(500, '/Payments', 'boom') });
    await expect(svc.runSync()).rejects.toBeInstanceOf(XeroApiError);
    expect(repo.failEntity).toHaveBeenCalledWith('payments', 'FAILED', expect.stringContaining('boom'));
  });
});

describe('XeroSyncService.reconcileOpen', () => {
  it('re-fetches open invoices by ID in batches of 50, after a full contacts pass', async () => {
    const { svc, client, repo } = setup();
    repo.openInvoiceIds.mockResolvedValue(Array.from({ length: 120 }, (_, i) => `id-${i}`));
    client.get.mockResolvedValue({ Invoices: [] });
    await svc.reconcileOpen();
    expect(client.pages.mock.calls[0][0]).toBe('/Contacts');
    expect(client.pages.mock.calls[0][2].modifiedSince).toBeNull();
    const idCalls = client.get.mock.calls.filter((c) => c[0] === '/Invoices');
    expect(idCalls).toHaveLength(3);
    expect(idCalls[0][1].params.IDs.split(',')).toHaveLength(50);
    expect(idCalls[2][1].params.IDs.split(',')).toHaveLength(20);
  });

  it('reports a contacts-pass failure against contacts, not invoices, and never touches the invoice batch', async () => {
    const { svc, repo } = setup({ '/Contacts': new XeroApiError(500, '/Contacts', 'boom') });
    await expect(svc.reconcileOpen()).rejects.toBeInstanceOf(XeroApiError);
    expect(repo.failEntity).toHaveBeenCalledWith('contacts', 'FAILED', expect.stringContaining('boom'));
    expect(repo.failEntity).not.toHaveBeenCalledWith('invoices', expect.anything(), expect.anything());
    expect(repo.openInvoiceIds).not.toHaveBeenCalled();
  });

  it('stops cleanly on the day budget during the contacts pass, recorded against contacts', async () => {
    const { svc, repo } = setup({ '/Contacts': new XeroRateBudgetExhaustedError(420) });
    const res = await svc.reconcileOpen();
    expect(res.stopped).toBe('rate_limited');
    expect(repo.failEntity).toHaveBeenCalledWith('contacts', 'RATE_LIMITED', expect.any(String));
    expect(repo.failEntity).not.toHaveBeenCalledWith('invoices', expect.anything(), expect.anything());
    expect(repo.openInvoiceIds).not.toHaveBeenCalled();
  });
});
