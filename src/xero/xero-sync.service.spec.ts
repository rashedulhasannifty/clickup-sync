import { Logger } from '@nestjs/common';
import { XeroSyncService } from './xero-sync.service';
import { XeroApiError, XeroRateBudgetExhaustedError, XeroReconnectRequiredError } from './xero-errors';

// The run summary is logged by design; keep test output clean.
let logSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => logSpy.mockRestore());

type Parent = { parentType: 'invoice' | 'creditNote' | 'bankTransaction'; id: string; updatedDateUtc: Date };
type Cursor = { updatedDateUtc: Date; id?: string } | null;
const T = (iso: string) => new Date(iso);
const PID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const parent = (n: number, iso: string, parentType: Parent['parentType'] = 'invoice'): Parent => ({ parentType, id: PID(n), updatedDateUtc: T(iso) });
const cmp = (a: Parent, b: Parent) => a.updatedDateUtc.getTime() - b.updatedDateUtc.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const U = (iso: string) => `/Date(${Date.parse(iso)}+0000)/`;
const inv = (id: string, updated: string, extra: Record<string, unknown> = {}) => ({
  InvoiceID: id, Type: 'ACCREC', Status: 'AUTHORISED', UpdatedDateUTC: U(updated), ...extra,
});

async function* gen(pages: unknown[][]) {
  for (const p of pages) yield p;
}

function setup(
  pagesByPath: Record<string, unknown[][] | Error> = {},
  watermark: Date | null = null,
  opts: { parents?: Parent[]; attachmentsWatermark?: Date } = {},
) {
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
  // A faithful fake of the attachment side of the DB: the `attachments` watermark persists
  // across runs, and attachmentParentsAfter honours the cursor, the global order and `take`.
  const parents = opts.parents ?? [];
  const att: { watermark: Date | null } = { watermark: opts.attachmentsWatermark ?? null };
  const isAfter = (p: Parent, c: Cursor) =>
    !c || p.updatedDateUtc > c.updatedDateUtc || (c.id !== undefined && p.updatedDateUtc.getTime() === c.updatedDateUtc.getTime() && p.id > c.id);
  const repo = {
    getSyncState: jest.fn(async (entity: string) =>
      entity === 'attachments' ? (att.watermark ? { watermark: att.watermark } : null) : watermark ? { watermark } : null,
    ),
    startEntity: jest.fn(), recordProgress: jest.fn(), failEntity: jest.fn(),
    finishEntity: jest.fn(async (entity: string, wm: Date | null) => {
      if (entity === 'attachments' && wm) att.watermark = wm;
    }),
    advanceWatermark: jest.fn(async (entity: string, wm: Date) => {
      if (entity === 'attachments') att.watermark = wm;
    }),
    attachmentParentsAfter: jest.fn(async (cursor: Cursor, take: number) => parents.filter((p) => isAfter(p, cursor)).sort(cmp).slice(0, take)),
    upsertContacts: jest.fn(), upsertInvoices: jest.fn(), upsertCreditNotes: jest.fn(), upsertBankTransactions: jest.fn(),
    upsertPayments: jest.fn(), replaceAttachments: jest.fn(), openInvoiceIds: jest.fn().mockResolvedValue([]),
  };
  return { svc: new XeroSyncService(client as never, repo as never), client, repo, att };
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

  it('fetches attachment lists for the flagged parents the DB returns, in one global order, and records the attachments row', async () => {
    const parents = [
      parent(1, '2026-09-10T00:00:00Z', 'invoice'),
      parent(2, '2026-09-08T00:00:00Z', 'creditNote'),
      parent(3, '2026-09-09T00:00:00Z', 'bankTransaction'),
    ];
    const { svc, client, repo, att } = setup({}, null, { parents });
    const res = await svc.runSync();
    expect(client.get.mock.calls.map((c) => c[0])).toEqual([
      `/CreditNotes/${PID(2)}/Attachments`, `/BankTransactions/${PID(3)}/Attachments`, `/Invoices/${PID(1)}/Attachments`,
    ]);
    expect(repo.replaceAttachments).toHaveBeenCalledWith(PID(1), [
      expect.objectContaining({ attachmentId: 'att-1', parentType: 'invoice', parentId: PID(1), fileName: 'SOW.pdf' }),
    ]);
    expect(repo.replaceAttachments).toHaveBeenCalledWith(PID(2), [expect.objectContaining({ parentType: 'creditNote' })]);
    expect(res.attachmentsFetched).toBe(3);
    // The Settings "Attachment lists" row must exist on a healthy run, not only after a failure.
    expect(repo.startEntity).toHaveBeenCalledWith('attachments');
    expect(repo.finishEntity).toHaveBeenCalledWith('attachments', T('2026-09-10T00:00:00Z'), 3);
    expect(att.watermark).toEqual(T('2026-09-10T00:00:00Z'));
  });

  it('with no flagged parents the attachments row still finishes OK and the watermark is kept', async () => {
    const wm = T('2026-09-01T00:00:00Z');
    const { svc, client, repo } = setup({}, null, { attachmentsWatermark: wm });
    await svc.runSync();
    expect(client.get).not.toHaveBeenCalled();
    expect(repo.attachmentParentsAfter).toHaveBeenCalledWith({ updatedDateUtc: wm }, expect.any(Number));
    expect(repo.finishEntity).toHaveBeenCalledWith('attachments', null, 0);
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

describe('XeroSyncService attachment phase resumes from its own watermark', () => {
  const three = () => [parent(1, '2026-09-01T00:00:00Z'), parent(2, '2026-09-02T00:00:00Z', 'creditNote'), parent(3, '2026-09-03T00:00:00Z')];
  const failOn = (id: string, err: Error) => (path: string) =>
    path.includes(id) ? Promise.reject(err) : Promise.resolve({ Attachments: [{ AttachmentID: 'att-1', FileName: 'SOW.pdf' }] });

  it('a budget stop mid-phase keeps the watermark at the last completed parent; the next run fetches only the rest', async () => {
    const { svc, client, repo, att } = setup({}, null, { parents: three() });
    client.get.mockImplementation(failOn(PID(3), new XeroRateBudgetExhaustedError(420)));

    const first = await svc.runSync();
    expect(first.stopped).toBe('rate_limited');
    expect(repo.failEntity).toHaveBeenCalledWith('attachments', 'RATE_LIMITED', expect.any(String));
    expect(repo.finishEntity).not.toHaveBeenCalledWith('attachments', expect.anything(), expect.anything());
    expect(att.watermark).toEqual(T('2026-09-02T00:00:00Z')); // parent 2 was the last one completed

    client.get.mockReset().mockResolvedValue({ Attachments: [] });
    const second = await svc.runSync();
    expect(second.stopped).toBeNull();
    expect(client.get.mock.calls.map((c) => c[0])).toEqual([`/Invoices/${PID(3)}/Attachments`]);
    expect(att.watermark).toEqual(T('2026-09-03T00:00:00Z'));
  });

  it('a reconnect stop mid-phase is clean and keeps the watermark reached so far', async () => {
    const { svc, client, repo, att } = setup({}, null, { parents: three() });
    client.get.mockImplementation(failOn(PID(2), new XeroReconnectRequiredError()));
    await expect(svc.runSync()).resolves.toMatchObject({ stopped: 'reconnect', attachmentsFetched: 1 });
    expect(repo.failEntity).toHaveBeenCalledWith('attachments', 'NEEDS_RECONNECT', expect.any(String));
    expect(att.watermark).toEqual(T('2026-09-01T00:00:00Z'));
  });

  it('any other failure mid-phase marks attachments FAILED, rethrows for a retry, and keeps the watermark', async () => {
    const { svc, client, repo, att } = setup({}, null, { parents: three() });
    client.get.mockImplementation(failOn(PID(3), new XeroApiError(500, '/Invoices/x/Attachments', 'boom')));
    await expect(svc.runSync()).rejects.toBeInstanceOf(XeroApiError);
    expect(repo.failEntity).toHaveBeenCalledWith('attachments', 'FAILED', expect.stringContaining('boom'));
    expect(att.watermark).toEqual(T('2026-09-02T00:00:00Z'));
  });

  it('a 404 on one parent is skipped, so the phase finishes and the watermark passes it', async () => {
    // Without the skip this parent stalls the phase forever: every run restarts at the same
    // watermark, fails on the same row, and never reaches a newer parent.
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { svc, client, repo, att } = setup({}, null, { parents: three() });
      client.get.mockImplementation(failOn(PID(2), new XeroApiError(404, `/CreditNotes/${PID(2)}/Attachments`, 'not found')));

      const res = await svc.runSync();

      expect(res.stopped).toBeNull();
      expect(res.attachmentsFetched).toBe(2); // parents 1 and 3; the skipped one is not counted
      expect(repo.replaceAttachments).not.toHaveBeenCalledWith(PID(2), expect.anything());
      expect(repo.failEntity).not.toHaveBeenCalledWith('attachments', expect.anything(), expect.anything());
      expect(repo.finishEntity).toHaveBeenCalledWith('attachments', T('2026-09-03T00:00:00Z'), 2);
      expect(att.watermark).toEqual(T('2026-09-03T00:00:00Z'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(PID(2)));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('pages through the parents in bounded batches with a keyset cursor', async () => {
    const parents = [1, 2, 3, 4, 5].map((n) => parent(n, `2026-09-0${n}T00:00:00Z`));
    const { svc, client, repo } = setup({}, null, { parents });
    svc.attachmentBatch = 2;
    const res = await svc.runSync();
    expect(res.attachmentsFetched).toBe(5);
    expect(client.get).toHaveBeenCalledTimes(5);
    const calls = repo.attachmentParentsAfter.mock.calls;
    expect(calls.map((c) => c[1])).toEqual([2, 2, 2]);
    expect(calls[0][0]).toBeNull();
    expect(calls[1][0]).toEqual({ updatedDateUtc: T('2026-09-02T00:00:00Z'), id: PID(2) });
  });

  it('never skips a parent that shares its UpdatedDateUTC with the last completed one', async () => {
    // Parents 1 and 2 share a timestamp. A stop on 2 must not persist that timestamp
    // (the next run reads strictly newer rows), or parent 2 would be lost for good.
    const parents = [parent(1, '2026-09-01T00:00:00Z'), parent(2, '2026-09-01T00:00:00Z'), parent(3, '2026-09-02T00:00:00Z')];
    const { svc, client, att } = setup({}, null, { parents });
    client.get.mockImplementation(failOn(PID(2), new XeroRateBudgetExhaustedError(420)));
    await svc.runSync();
    expect(att.watermark).toBeNull();

    client.get.mockReset().mockResolvedValue({ Attachments: [] });
    await svc.runSync();
    expect(client.get.mock.calls.map((c) => c[0])).toEqual([1, 2, 3].map((n) => `/Invoices/${PID(n)}/Attachments`));
    expect(att.watermark).toEqual(T('2026-09-02T00:00:00Z'));
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
