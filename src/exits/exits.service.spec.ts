import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExitsService } from './exits.service';

const admin = {
  userId: 'u-admin',
  orgId: 'org',
  role: 'ADMIN',
  email: 'a@x',
  isMachine: false,
} as never;

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  exitId: 'x1',
  group: 'ASSETS',
  key: 'asset_laptop',
  label: 'Laptop',
  position: 0,
  done: true,
  doneBy: null,
  doneAt: null,
  notApplicable: false,
  notApplicableBy: null,
  notApplicableAt: null,
  note: null,
  ...over,
});

const exitRow = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  employeeId: 'e1',
  type: 'RESIGNATION',
  status: 'CLEARANCE',
  noticeDate: new Date('2026-10-01T00:00:00Z'),
  lastWorkingDay: new Date('2026-10-31T00:00:00Z'),
  reason: null,
  previousStatus: 'ACTIVE',
  interviewReason: null,
  ratingRole: null,
  ratingLead: null,
  ratingCompensation: null,
  ratingGrowth: null,
  ratingEnvironment: null,
  interviewFeedback: null,
  wouldRecommend: null,
  wouldRejoin: null,
  interviewNotes: null,
  interviewBy: null,
  interviewAt: null,
  overrideNote: null,
  loginDisabled: false,
  completedAt: null,
  completedBy: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelNote: null,
  createdBy: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  employee: {
    id: 'e1',
    fullName: 'Ada Lovelace',
    employeeCode: 'E-1',
    designation: 'Engineer',
    department: null,
    joinDate: new Date('2024-01-01T00:00:00Z'),
    userId: 'user-1',
    status: 'NOTICE',
    team: null,
  },
  items: [item()],
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  status: 'ACTIVE',
  joinDate: '2024-01-01',
  confirmationDate: '2024-04-01',
  userId: 'user-1',
  ...over,
});

const docView = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  docType: 'EXPERIENCE_LETTER',
  fileName: 'Experience letter - Ada Lovelace.pdf',
  contentType: 'application/pdf',
  version: 1,
  createdAt: '2026-10-07T00:00:00.000Z',
  ...over,
});

function make(
  row = exitRow(),
  over: {
    repo?: Record<string, jest.Mock>;
    employees?: Record<string, jest.Mock>;
    users?: Record<string, jest.Mock>;
    documents?: Record<string, jest.Mock>;
  } = {},
) {
  const repo = {
    findById: jest.fn().mockResolvedValue(row),
    findForEmployee: jest.fn().mockResolvedValue(row),
    hasActive: jest.fn().mockResolvedValue(false),
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(row),
    deleteById: jest.fn().mockResolvedValue(undefined),
    updateDetails: jest.fn().mockResolvedValue(undefined),
    saveInterview: jest.fn().mockResolvedValue(undefined),
    claim: jest.fn().mockResolvedValue(true),
    addItem: jest.fn().mockResolvedValue(undefined),
    markKeyedItemDone: jest.fn().mockResolvedValue(true),
    findItem: jest.fn().mockResolvedValue(item()),
    updateItem: jest.fn().mockResolvedValue(undefined),
    deleteItem: jest.fn().mockResolvedValue(undefined),
    userNames: jest.fn().mockResolvedValue([]),
    organisationName: jest.fn().mockResolvedValue('Acme Ltd'),
    ...over.repo,
  };
  const employees = {
    getProfile: jest.fn().mockResolvedValue(profile()),
    recordExitEvent: jest.fn().mockResolvedValue({}),
    restoreStatus: jest.fn().mockResolvedValue(undefined),
    ...over.employees,
  };
  const users = {
    setStatus: jest.fn().mockResolvedValue({}),
    ...over.users,
  };
  const documents = {
    currentInCategory: jest.fn().mockResolvedValue([]),
    storeGenerated: jest.fn().mockResolvedValue(docView()),
    ...over.documents,
  };
  const svc = new ExitsService(
    repo as never,
    employees as never,
    documents as never,
    users as never,
  );
  return { svc, repo, employees, users, documents };
}

describe('start', () => {
  const dto = {
    type: 'RESIGNATION',
    noticeDate: '2026-10-01',
    lastWorkingDay: '2026-10-31',
    reason: ' Moving abroad ',
  } as never;

  it('creates the exit with the default checklist and writes NOTICE_GIVEN', async () => {
    const { svc, repo, employees } = make();
    await svc.start(admin, 'e1', dto);
    const created = repo.create.mock.calls[0][0];
    expect(created).toMatchObject({
      employeeId: 'e1',
      type: 'RESIGNATION',
      noticeDate: '2026-10-01',
      lastWorkingDay: '2026-10-31',
      reason: 'Moving abroad',
      previousStatus: 'ACTIVE',
    });
    expect(created.clearanceItems).toHaveLength(21);
    expect(created.clearanceItems.filter((i: { group: string }) => i.group === 'ASSETS')).toHaveLength(6);
    expect(created.clearanceItems).toContainEqual({
      group: 'PROCESS',
      key: 'exit_interview',
      label: 'Conduct exit interview',
    });
    expect(employees.recordExitEvent).toHaveBeenCalledWith(admin, 'e1', {
      type: 'NOTICE_GIVEN',
      effectiveDate: '2026-10-01',
      notes: 'Resignation: Moving abroad',
    });
  });

  it('remembers PROBATION or ACTIVE for someone already on NOTICE', async () => {
    const { svc, repo } = make(exitRow(), {
      employees: {
        getProfile: jest
          .fn()
          .mockResolvedValue(profile({ status: 'NOTICE', confirmationDate: null })),
      },
    });
    await svc.start(admin, 'e1', dto);
    expect(repo.create.mock.calls[0][0].previousStatus).toBe('PROBATION');
  });

  it('allows only one active exit per employee', async () => {
    const { svc, repo } = make(exitRow(), {
      repo: { hasActive: jest.fn().mockResolvedValue(true) },
    });
    await expect(svc.start(admin, 'e1', dto)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('maps the unique-index race to a 409', async () => {
    const { svc } = make(exitRow(), {
      repo: { create: jest.fn().mockRejectedValue({ code: 'P2002' }) },
    });
    await expect(svc.start(admin, 'e1', dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an employee who has already exited', async () => {
    const { svc } = make(exitRow(), {
      employees: { getProfile: jest.fn().mockResolvedValue(profile({ status: 'EXITED' })) },
    });
    await expect(svc.start(admin, 'e1', dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a last working day before the notice date', async () => {
    const { svc } = make();
    await expect(
      svc.start(admin, 'e1', { ...(dto as object), lastWorkingDay: '2026-09-01' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes the exit again if the NOTICE_GIVEN event cannot be written', async () => {
    const { svc, repo } = make(exitRow(), {
      employees: { recordExitEvent: jest.fn().mockRejectedValue(new Error('db')) },
    });
    await expect(svc.start(admin, 'e1', dto)).rejects.toThrow('db');
    expect(repo.deleteById).toHaveBeenCalledWith('x1');
  });

  it('is a 404 for an employee in another org', async () => {
    const { svc } = make(exitRow(), {
      employees: { getProfile: jest.fn().mockRejectedValue(new NotFoundException()) },
    });
    await expect(svc.start(admin, 'other', dto)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('complete', () => {
  it('writes EXITED on the last working day and disables a linked login by default', async () => {
    const { svc, users, employees, repo } = make();
    await svc.complete(admin, 'x1', {});
    expect(repo.claim).toHaveBeenCalledWith(
      'x1',
      ['CLEARANCE'],
      expect.objectContaining({ status: 'COMPLETED', loginDisabled: true, overrideNote: null }),
    );
    expect(users.setStatus).toHaveBeenCalledWith(admin, 'user-1', 'DISABLED');
    expect(employees.recordExitEvent).toHaveBeenCalledWith(admin, 'e1', {
      type: 'EXITED',
      effectiveDate: '2026-10-31',
      notes: 'Offboarding completed',
    });
  });

  it('leaves the login alone when disableLogin is false', async () => {
    const { svc, users, repo } = make();
    await svc.complete(admin, 'x1', { disableLogin: false });
    expect(users.setStatus).not.toHaveBeenCalled();
    expect(repo.claim.mock.calls[0][2].loginDisabled).toBe(false);
  });

  it('does not touch a login when the employee has none', async () => {
    const row = exitRow();
    row.employee.userId = null as never;
    const { svc, users } = make(row);
    await svc.complete(admin, 'x1', { disableLogin: true });
    expect(users.setStatus).not.toHaveBeenCalled();
  });

  it('refuses while clearance items are open and no override note is given', async () => {
    const { svc, repo, employees } = make(
      exitRow({ items: [item(), item({ id: 'i2', done: false })] }),
    );
    await expect(svc.complete(admin, 'x1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.claim).not.toHaveBeenCalled();
    expect(employees.recordExitEvent).not.toHaveBeenCalled();
  });

  it('completes without an override when every open item is done or not applicable', async () => {
    const { svc, repo, employees } = make(
      exitRow({ items: [item(), item({ id: 'i2', done: false, notApplicable: true })] }),
    );
    await svc.complete(admin, 'x1', {});
    expect(repo.claim.mock.calls[0][2].overrideNote).toBeNull();
    expect(employees.recordExitEvent.mock.calls[0][2].notes).toBe('Offboarding completed');
  });

  it('completes with open items when an override note is given, and keeps the note', async () => {
    const { svc, repo, employees } = make(
      exitRow({ items: [item({ done: false })] }),
    );
    await svc.complete(admin, 'x1', { overrideNote: 'Laptop is in transit' });
    expect(repo.claim.mock.calls[0][2].overrideNote).toBe('Laptop is in transit');
    expect(employees.recordExitEvent.mock.calls[0][2].notes).toContain('1 open clearance item: Laptop is in transit');
  });

  it('only completes from CLEARANCE', async () => {
    const { svc } = make(exitRow({ status: 'INTERVIEW' }));
    await expect(svc.complete(admin, 'x1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('puts the exit back and writes nothing if the login cannot be disabled', async () => {
    const { svc, repo, employees } = make(exitRow(), {
      users: { setStatus: jest.fn().mockRejectedValue(new ForbiddenException()) },
    });
    await expect(svc.complete(admin, 'x1', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(employees.recordExitEvent).not.toHaveBeenCalled();
    expect(repo.claim).toHaveBeenLastCalledWith(
      'x1',
      ['COMPLETED'],
      expect.objectContaining({ status: 'CLEARANCE', loginDisabled: false }),
    );
  });

  it('is a 409 when someone else completed it first', async () => {
    const { svc, users } = make(exitRow(), {
      repo: { claim: jest.fn().mockResolvedValue(false) },
    });
    await expect(svc.complete(admin, 'x1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(users.setStatus).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it('restores the status the employee had before with a NOTE', async () => {
    const { svc, repo, employees } = make(exitRow({ status: 'INTERVIEW', previousStatus: 'PROBATION' }));
    await svc.cancel(admin, 'x1', { note: 'Stayed on' });
    expect(repo.claim).toHaveBeenCalledWith(
      'x1',
      ['INTERVIEW'],
      expect.objectContaining({ status: 'CANCELLED', cancelNote: 'Stayed on' }),
    );
    expect(employees.restoreStatus).toHaveBeenCalledWith(admin, 'e1', 'PROBATION', 'Offboarding cancelled: Stayed on');
  });

  it('does not overwrite a status someone changed by hand since', async () => {
    const row = exitRow();
    row.employee.status = 'ACTIVE' as never;
    const { svc, employees } = make(row);
    await svc.cancel(admin, 'x1', { note: 'n' });
    expect(employees.restoreStatus).not.toHaveBeenCalled();
  });

  it('needs a note and an active exit', async () => {
    await expect(make().svc.cancel(admin, 'x1', { note: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      make(exitRow({ status: 'COMPLETED' })).svc.cancel(admin, 'x1', { note: 'n' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reopens the exit if the status cannot be restored', async () => {
    const { svc, repo } = make(exitRow({ status: 'NOTICE' }), {
      employees: { restoreStatus: jest.fn().mockRejectedValue(new Error('db')) },
    });
    await expect(svc.cancel(admin, 'x1', { note: 'n' })).rejects.toThrow('db');
    expect(repo.claim).toHaveBeenLastCalledWith(
      'x1',
      ['CANCELLED'],
      expect.objectContaining({ status: 'NOTICE', cancelNote: null }),
    );
  });
});

describe('advance', () => {
  it('moves NOTICE to INTERVIEW and INTERVIEW to CLEARANCE', async () => {
    const a = make(exitRow({ status: 'NOTICE' }));
    await a.svc.advance('org', 'x1');
    expect(a.repo.claim).toHaveBeenCalledWith('x1', ['NOTICE'], { status: 'INTERVIEW' });
    const b = make(exitRow({ status: 'INTERVIEW' }));
    await b.svc.advance('org', 'x1');
    expect(b.repo.claim).toHaveBeenCalledWith('x1', ['INTERVIEW'], { status: 'CLEARANCE' });
  });
  it('has nowhere to go from CLEARANCE', async () => {
    await expect(make().svc.advance('org', 'x1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('letters', () => {
  it('generates a PDF and stores it as an EXIT document of the right type', async () => {
    const { svc, documents } = make();
    const res = await svc.generateLetter(admin, 'x1', 'experience');
    const [, employeeId, input] = documents.storeGenerated.mock.calls[0];
    expect(employeeId).toBe('e1');
    expect(input).toMatchObject({
      category: 'EXIT',
      docType: 'EXPERIENCE_LETTER',
      fileName: 'Experience letter - Ada Lovelace.pdf',
    });
    expect(input.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.id).toBe('d1');
  });

  it('files the release letter as RELEASE_LETTER; regenerating hands the same slot to the documents module to replace', async () => {
    const { svc, documents } = make();
    await svc.generateLetter(admin, 'x1', 'release');
    await svc.generateLetter(admin, 'x1', 'release');
    expect(documents.storeGenerated).toHaveBeenCalledTimes(2);
    for (const call of documents.storeGenerated.mock.calls)
      expect(call[2]).toMatchObject({ category: 'EXIT', docType: 'RELEASE_LETTER' });
  });

  it('rejects an unknown kind and a cancelled exit', async () => {
    await expect(make().svc.generateLetter(admin, 'x1', 'offer')).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      make(exitRow({ status: 'CANCELLED' })).svc.generateLetter(admin, 'x1', 'release'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('is allowed after completion', async () => {
    const { svc, documents } = make(exitRow({ status: 'COMPLETED' }));
    await svc.generateLetter(admin, 'x1', 'release');
    expect(documents.storeGenerated).toHaveBeenCalled();
  });
});

describe('edits and clearance items', () => {
  it('refuses edits once the exit is no longer active', async () => {
    const { svc, repo } = make(exitRow({ status: 'COMPLETED' }));
    await expect(svc.update('org', 'x1', { reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.addClearanceItem('org', 'x1', 'Badge', 'ASSETS')).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.updateClearanceItem(admin, 'x1', 'i1', { notApplicable: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateItem).not.toHaveBeenCalled();
    await expect(svc.saveInterview(admin, 'x1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateDetails).not.toHaveBeenCalled();
  });

  it('validates a changed date against the stored one', async () => {
    const { svc } = make();
    await expect(svc.update('org', 'x1', { lastWorkingDay: '2026-09-01' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records who ticked an item and when, and clears it on untick', async () => {
    const { svc, repo } = make();
    await svc.updateClearanceItem(admin, 'x1', 'i1', { done: true });
    expect(repo.updateItem.mock.calls[0][1]).toMatchObject({ done: true, doneBy: 'u-admin' });
    await svc.updateClearanceItem(admin, 'x1', 'i1', { done: false });
    expect(repo.updateItem.mock.calls[1][1]).toEqual({ done: false, doneBy: null, doneAt: null });
  });

  it('ticking done clears Not applicable, and marking N/A clears done', async () => {
    const { svc, repo } = make();
    await svc.updateClearanceItem(admin, 'x1', 'i1', { done: true });
    expect(repo.updateItem.mock.calls[0][1]).toMatchObject({
      done: true,
      doneBy: 'u-admin',
      notApplicable: false,
      notApplicableBy: null,
      notApplicableAt: null,
    });
    await svc.updateClearanceItem(admin, 'x1', 'i1', { notApplicable: true });
    const na = repo.updateItem.mock.calls[1][1];
    expect(na).toMatchObject({
      notApplicable: true,
      notApplicableBy: 'u-admin',
      done: false,
      doneBy: null,
      doneAt: null,
    });
    expect(na.notApplicableAt).toBeInstanceOf(Date);
  });

  it('un-marking N/A clears only the N/A fields', async () => {
    const { svc, repo } = make();
    await svc.updateClearanceItem(admin, 'x1', 'i1', { notApplicable: false });
    expect(repo.updateItem.mock.calls[0][1]).toEqual({
      notApplicable: false,
      notApplicableBy: null,
      notApplicableAt: null,
    });
  });

  it('refuses done and not applicable together, before touching anything', async () => {
    const { svc, repo } = make();
    await expect(
      svc.updateClearanceItem(admin, 'x1', 'i1', { done: true, notApplicable: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  it('treats null flags as no change and still saves a note', async () => {
    const { svc, repo } = make();
    await svc.updateClearanceItem(admin, 'x1', 'i1', {
      done: null,
      notApplicable: null,
      note: ' Courier tracking 123 ',
    } as never);
    expect(repo.updateItem.mock.calls[0][1]).toEqual({ note: 'Courier tracking 123' });
  });

  it('adds a custom item to the chosen group', async () => {
    const { svc, repo } = make();
    await svc.addClearanceItem('org', 'x1', '  Parking pass ', 'ASSETS');
    expect(repo.addItem).toHaveBeenCalledWith('x1', 'Parking pass', 'ASSETS');
    await svc.addClearanceItem('org', 'x1', 'Call the client', undefined);
    expect(repo.addItem).toHaveBeenLastCalledWith('x1', 'Call the client', 'PROCESS');
    await expect(svc.addClearanceItem('org', 'x1', '   ', 'PROCESS')).rejects.toBeInstanceOf(BadRequestException);
  });

  it("will not touch another exit's item", async () => {
    const { svc, repo } = make(exitRow(), {
      repo: { findItem: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.updateClearanceItem(admin, 'x1', 'foreign', { done: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.removeClearanceItem('org', 'x1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.updateItem).not.toHaveBeenCalled();
    expect(repo.deleteItem).not.toHaveBeenCalled();
  });

  it('shows an interview only once one is saved, and every lookup is org-scoped', async () => {
    const { svc, repo } = make(exitRow({ status: 'INTERVIEW' }));
    const view = await svc.saveInterview(admin, 'x1', { primaryReason: 'CAREER_GROWTH', ratingRole: 4 });
    expect(repo.saveInterview.mock.calls[0][1]).toMatchObject({ interviewReason: 'CAREER_GROWTH', ratingRole: 4, ratingGrowth: null });
    expect(repo.findById).toHaveBeenCalledWith('org', 'x1');
    expect(view.interview).toBeNull(); // the mocked reload row has no interviewAt
  });

  it('saving the interview ticks the "Conduct exit interview" item by key, as the interviewer', async () => {
    const { svc, repo } = make(exitRow({ status: 'INTERVIEW' }));
    await svc.saveInterview(admin, 'x1', {});
    expect(repo.markKeyedItemDone).toHaveBeenCalledWith('x1', 'exit_interview', 'u-admin');
    expect(repo.saveInterview.mock.invocationCallOrder[0]).toBeLessThan(
      repo.markKeyedItemDone.mock.invocationCallOrder[0],
    );
  });

  it('saving the interview still succeeds when the item is already resolved or was removed', async () => {
    const { svc, repo } = make(exitRow({ status: 'INTERVIEW' }), {
      repo: { markKeyedItemDone: jest.fn().mockResolvedValue(false) },
    });
    await expect(svc.saveInterview(admin, 'x1', {})).resolves.toBeDefined();
    expect(repo.saveInterview).toHaveBeenCalled();
  });

  it('a machine credential ticks the interview item with no actor', async () => {
    const machine = { ...(admin as object), isMachine: true } as never;
    const { svc, repo } = make(exitRow({ status: 'INTERVIEW' }));
    await svc.saveInterview(machine, 'x1', {});
    expect(repo.markKeyedItemDone).toHaveBeenCalledWith('x1', 'exit_interview', null);
  });

  it('does not tick anything when the interview cannot be saved on a closed exit', async () => {
    const { svc, repo } = make(exitRow({ status: 'COMPLETED' }));
    await expect(svc.saveInterview(admin, 'x1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(repo.markKeyedItemDone).not.toHaveBeenCalled();
  });

  it('is a 404 for an exit in another org', async () => {
    const { svc } = make(exitRow(), { repo: { findById: jest.fn().mockResolvedValue(null) } });
    await expect(svc.advance('org', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('forEmployee', () => {
  it('wraps a missing exit as { exit: null }', async () => {
    const { svc } = make(exitRow(), { repo: { findForEmployee: jest.fn().mockResolvedValue(null) } });
    await expect(svc.forEmployee('org', 'e1')).resolves.toEqual({ exit: null });
  });
  it('builds the view with documents and the allowed actions', async () => {
    const { svc } = make(exitRow(), {
      documents: { currentInCategory: jest.fn().mockResolvedValue([docView()]) },
    });
    const { exit } = await svc.forEmployee('org', 'e1');
    expect(exit?.documents).toEqual([docView()]);
    expect(exit?.allowed).toEqual({ edit: true, advance: false, complete: true, cancel: true, letters: true });
    expect(exit?.employee.hasLogin).toBe(true);
    expect(exit?.clearance).toMatchObject({ done: 1, total: 1 });
  });

  it('counts done, N/A and resolved separately, and names who resolved each item', async () => {
    const row = exitRow({
      items: [
        item({ doneBy: 'u1', doneAt: new Date('2026-10-05T00:00:00Z') }),
        item({
          id: 'i2',
          done: false,
          notApplicable: true,
          notApplicableBy: 'u2',
          notApplicableAt: new Date('2026-10-06T00:00:00Z'),
        }),
        item({ id: 'i3', group: 'PROCESS', key: null, done: false }),
      ],
    });
    const { svc, repo } = make(row, {
      repo: {
        userNames: jest.fn().mockResolvedValue([
          { id: 'u1', name: 'Hana', email: 'h@x' },
          { id: 'u2', name: null, email: 'nb@x' },
        ]),
      },
    });
    const { exit } = await svc.forEmployee('org', 'e1');
    expect(exit?.clearance).toMatchObject({ done: 1, notApplicable: 1, resolved: 2, total: 3 });
    expect(exit?.clearance.items[1]).toMatchObject({
      group: 'ASSETS',
      notApplicable: true,
      notApplicableAt: '2026-10-06T00:00:00.000Z',
      notApplicableByName: 'nb@x',
      done: false,
      doneByName: null,
    });
    expect(exit?.clearance.items[2]).toMatchObject({ group: 'PROCESS', key: null, notApplicable: false });
    expect(exit?.clearance.items[0].doneByName).toBe('Hana');
    expect(repo.userNames.mock.calls[0][0]).toEqual(expect.arrayContaining(['u1', 'u2']));
  });

  it('names who completed (approved) the exit', async () => {
    const { svc } = make(
      exitRow({ status: 'COMPLETED', completedBy: 'u9', completedAt: new Date('2026-10-31T10:00:00Z') }),
      { repo: { userNames: jest.fn().mockResolvedValue([{ id: 'u9', name: 'Rashed', email: 'r@x' }]) } },
    );
    const { exit } = await svc.forEmployee('org', 'e1');
    expect(exit?.completedByName).toBe('Rashed');
    expect(exit?.completedAt).toBe('2026-10-31T10:00:00.000Z');
  });

  it('leaves the approver unnamed for a machine credential or a deleted user', async () => {
    const machineDone = make(exitRow({ status: 'COMPLETED', completedBy: null, completedAt: new Date() }));
    expect((await machineDone.svc.forEmployee('org', 'e1')).exit?.completedByName).toBeNull();
    const deleted = make(exitRow({ status: 'COMPLETED', completedBy: 'gone', completedAt: new Date() }));
    expect((await deleted.svc.forEmployee('org', 'e1')).exit?.completedByName).toBeNull();
  });
});

describe('list', () => {
  it('turns status=active into the three active statuses', async () => {
    const { svc, repo } = make();
    await svc.list('org', { status: 'active' });
    expect(repo.list).toHaveBeenCalledWith('org', ['NOTICE', 'INTERVIEW', 'CLEARANCE']);
    await svc.list('org', {});
    expect(repo.list).toHaveBeenLastCalledWith('org', undefined);
  });

  it('counts resolved (done or N/A) items in each row', async () => {
    const { svc } = make(exitRow(), {
      repo: {
        list: jest.fn().mockResolvedValue([
          {
            ...exitRow(),
            items: [
              { done: true, notApplicable: false },
              { done: false, notApplicable: true },
              { done: false, notApplicable: false },
            ],
          },
        ]),
      },
    });
    const [row] = await svc.list('org', {});
    expect(row).toMatchObject({ clearanceResolved: 2, clearanceTotal: 3 });
  });
});
