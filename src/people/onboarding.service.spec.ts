import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

const admin = {
  userId: 'u-admin',
  orgId: 'org',
  role: 'ADMIN',
  email: 'a@x',
  isMachine: false,
} as never;

const employee = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  orgId: 'org',
  status: 'ACTIVE',
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  employeeId: 'e1',
  group: 'DOCUMENTS',
  key: 'doc_resume',
  label: 'Resume',
  position: 0,
  done: false,
  doneBy: null,
  doneAt: null,
  notApplicable: false,
  notApplicableBy: null,
  notApplicableAt: null,
  note: null,
  detail: null,
  documentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function make(
  over: {
    items?: unknown[];
    employee?: unknown;
    repo?: Record<string, jest.Mock>;
  } = {},
) {
  const items = over.items ?? [item()];
  const repo = {
    listForEmployee: jest.fn().mockResolvedValue(items),
    seedDefaults: jest.fn().mockResolvedValue(28),
    findItem: jest
      .fn()
      .mockImplementation(
        async (_e: string, id: string) =>
          (items as { id: string }[]).find((i) => i.id === id) ?? null,
      ),
    addItem: jest.fn().mockResolvedValue(undefined),
    updateItem: jest.fn().mockResolvedValue(undefined),
    deleteItem: jest.fn().mockResolvedValue(undefined),
    isLinkableDocument: jest.fn().mockResolvedValue(true),
    documentsForEmployee: jest.fn().mockResolvedValue([]),
    issuedEquipment: jest.fn().mockResolvedValue([]),
    progressFor: jest.fn().mockResolvedValue(new Map()),
    userNames: jest
      .fn()
      .mockResolvedValue([{ id: 'u-admin', name: 'Admin', email: 'a@x' }]),
    ...over.repo,
  };
  const employees = {
    findById: jest
      .fn()
      .mockImplementation(async (orgId: string) =>
        orgId === 'org' ? (over.employee ?? employee()) : null,
      ),
  };
  return {
    svc: new OnboardingService(repo as never, employees as never),
    repo,
    employees,
  };
}

describe('OnboardingService: start', () => {
  it('seeds the default checklist (idempotency lives in the unique (employee, key) index)', async () => {
    const { svc, repo } = make({ items: [] });
    const view = await svc.start(admin, 'e1');
    expect(repo.seedDefaults).toHaveBeenCalledWith('e1');
    expect(view.started).toBe(false); // the mock still returns no rows; the real repo returns 28
  });

  it('404s an employee outside the org', async () => {
    const { svc, repo } = make();
    await expect(
      svc.start({ ...(admin as object), orgId: 'other' } as never, 'e1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.seedDefaults).not.toHaveBeenCalled();
  });
});

describe('OnboardingService: an exited employee is read-only', () => {
  const exited = employee({ status: 'EXITED' });

  it('refuses every write with 409 and writes nothing', async () => {
    const { svc, repo } = make({
      employee: exited,
      items: [item(), item({ id: 'c1', key: null })],
    });
    await expect(svc.start(admin, 'e1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      svc.addItem(admin, 'e1', { group: 'EQUIPMENT', label: 'Monitor' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.updateItem(admin, 'e1', 'i1', { done: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.removeItem(admin, 'e1', 'c1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    for (const w of [
      'seedDefaults',
      'addItem',
      'updateItem',
      'deleteItem',
    ] as const)
      expect(repo[w]).not.toHaveBeenCalled();
  });

  it('still serves the checklist, flagged read-only', async () => {
    const { svc } = make({ employee: exited });
    const view = await svc.get('org', 'e1');
    expect(view.readOnly).toBe(true);
    expect(view.total).toBe(1);
  });
});

describe('OnboardingService: updating an item', () => {
  it('ticks done with the actor, and refuses done + N/A together', async () => {
    const { svc, repo } = make();
    await svc.updateItem(admin, 'e1', 'i1', {
      done: true,
      note: '  seen original  ',
    });
    expect(repo.updateItem).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({
        done: true,
        doneBy: 'u-admin',
        note: 'seen original',
      }),
    );

    repo.updateItem.mockClear();
    await expect(
      svc.updateItem(admin, 'e1', 'i1', { done: true, notApplicable: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  it('links a current document of the same employee and marks the item done', async () => {
    const { svc, repo } = make();
    await svc.updateItem(admin, 'e1', 'i1', { documentId: 'd1' });
    expect(repo.isLinkableDocument).toHaveBeenCalledWith('e1', 'd1');
    expect(repo.updateItem).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ documentId: 'd1', done: true }),
    );
  });

  it('refuses another employee’s, a replaced or a deleted document (the repo check covers all three) and writes nothing', async () => {
    const { svc, repo } = make({
      repo: { isLinkableDocument: jest.fn().mockResolvedValue(false) },
    });
    await expect(
      svc.updateItem(admin, 'e1', 'i1', { documentId: 'foreign' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  it('stores detail (e.g. a laptop serial), and null/blank clears it', async () => {
    const { svc, repo } = make({
      items: [item({ group: 'EQUIPMENT', key: 'eq_laptop' })],
    });
    await svc.updateItem(admin, 'e1', 'i1', { detail: 'SN-123' });
    expect(repo.updateItem).toHaveBeenLastCalledWith('i1', {
      detail: 'SN-123',
    });
    await svc.updateItem(admin, 'e1', 'i1', { detail: '  ' });
    expect(repo.updateItem).toHaveBeenLastCalledWith('i1', { detail: null });
  });

  it('404s an item that belongs to another employee', async () => {
    const { svc } = make();
    await expect(
      svc.updateItem(admin, 'e1', 'nope', { done: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OnboardingService: custom items', () => {
  it('adds a trimmed custom item to a group', async () => {
    const { svc, repo } = make();
    await svc.addItem(admin, 'e1', { group: 'EQUIPMENT', label: '  Monitor ' });
    expect(repo.addItem).toHaveBeenCalledWith('e1', 'EQUIPMENT', 'Monitor');
  });

  it('deletes a custom item but refuses a seeded one (mark it N/A instead)', async () => {
    const { svc, repo } = make({
      items: [item(), item({ id: 'c1', key: null })],
    });
    await expect(svc.removeItem(admin, 'e1', 'i1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.deleteItem).not.toHaveBeenCalled();
    await svc.removeItem(admin, 'e1', 'c1');
    expect(repo.deleteItem).toHaveBeenCalledWith('c1');
  });
});

describe('OnboardingService: the view', () => {
  it('groups items in form order with progress per group and overall', async () => {
    const { svc } = make({
      items: [
        item({
          id: 'a',
          done: true,
          doneBy: 'u-admin',
          doneAt: new Date('2026-10-01T00:00:00Z'),
        }),
        item({ id: 'b', key: 'doc_job_application', notApplicable: true }),
        item({ id: 'c', key: 'eq_laptop', group: 'EQUIPMENT' }),
        item({ id: 'd', key: null, group: 'WELCOME', label: 'Mug' }),
      ],
    });
    const v = await svc.get('org', 'e1');
    expect(v).toMatchObject({
      started: true,
      readOnly: false,
      resolved: 2,
      total: 4,
    });
    expect(v.groups.map((g) => [g.group, g.resolved, g.total])).toEqual([
      ['DOCUMENTS', 2, 2],
      ['EQUIPMENT', 0, 1],
      ['ACCOUNTS', 0, 0],
      ['WELCOME', 0, 1],
    ]);
    const a = v.groups[0].items[0];
    expect(a).toMatchObject({
      doneByName: 'Admin',
      doneAt: '2026-10-01T00:00:00.000Z',
      custom: false,
      suggested: { category: 'EMPLOYMENT', docType: 'RESUME' },
    });
    expect(v.groups[1].items[0].suggested).toBeNull();
    expect(v.groups[3].items[0].custom).toBe(true);
  });

  it('shows a replaced document as its current version and a deleted one as removed', async () => {
    const { svc } = make({
      items: [
        item({ id: 'a', done: true, documentId: 'v1' }),
        item({ id: 'b', key: 'doc_photos', done: true, documentId: 'gone' }),
      ],
      repo: {
        documentsForEmployee: jest.fn().mockResolvedValue([
          {
            id: 'v1',
            fileName: 'cv.pdf',
            contentType: 'application/pdf',
            version: 1,
            replacedById: 'v2',
            deletedAt: null,
          },
          {
            id: 'v2',
            fileName: 'cv-2.pdf',
            contentType: 'application/pdf',
            version: 2,
            replacedById: null,
            deletedAt: null,
          },
          {
            id: 'gone',
            fileName: 'p.jpg',
            contentType: 'image/jpeg',
            version: 1,
            replacedById: null,
            deletedAt: new Date(),
          },
        ]),
      },
    });
    const [a, b] = (await svc.get('org', 'e1')).groups[0].items;
    expect(a).toMatchObject({
      documentStatus: 'linked',
      document: { id: 'v2', fileName: 'cv-2.pdf', version: 2 },
    });
    expect(b).toMatchObject({ documentStatus: 'removed', document: null });
  });
});

describe('OnboardingService.issuedEquipment', () => {
  it('returns the done EQUIPMENT items as { key, label, detail }', async () => {
    const { svc, repo } = make({
      repo: {
        issuedEquipment: jest
          .fn()
          .mockResolvedValue([
            { key: 'eq_laptop', label: 'Laptop', detail: 'SN-1' },
          ]),
      },
    });
    expect(await svc.issuedEquipment('e1')).toEqual([
      { key: 'eq_laptop', label: 'Laptop', detail: 'SN-1' },
    ]);
    expect(repo.issuedEquipment).toHaveBeenCalledWith('e1');
  });
});
