import { ForbiddenException } from '@nestjs/common';
import { resolveScope } from './access-scope';
import { ChargeabilityAccessService } from './chargeability-access.service';

const lead = resolveScope({ role: 'MEMBER', scopingEnabled: true, selfClickupId: null,
  memberships: [{ teamId: 'A', role: 'LEAD' }, { teamId: 'B', role: 'MEMBER' }],
  teamClients: [{ teamId: 'A', optionId: 'acme' }, { teamId: 'B', optionId: 'bolt' }], teamMembers: [] });

function svc(tasks: { taskId: string; scopeClientOptionId: string | null }[]) {
  const prisma = {
    clickupTask: { findMany: jest.fn().mockResolvedValue(tasks) },
    clickupTimeEntry: { findMany: jest.fn().mockResolvedValue(tasks.map((t, i) => ({ timeEntryId: `e${i}`, task: t }))) },
  };
  return new ChargeabilityAccessService(prisma as any);
}

describe('ChargeabilityAccessService', () => {
  it('allows a lead on their clients', async () => {
    await expect(svc([{ taskId: 't1', scopeClientOptionId: 'acme' }]).assertTasks(lead, ['t1'])).resolves.toBeUndefined();
  });
  it('rejects the WHOLE request if one task is on a member-only client', async () => {
    await expect(svc([{ taskId: 't1', scopeClientOptionId: 'acme' }, { taskId: 't2', scopeClientOptionId: 'bolt' }])
      .assertTasks(lead, ['t1', 't2'])).rejects.toThrow(ForbiddenException);
  });
  it('rejects unknown ids (not found counts as out of scope)', async () => {
    await expect(svc([]).assertTasks(lead, ['nope'])).rejects.toThrow(ForbiddenException);
  });
  it('rejects a flag-off MEMBER', async () => {
    const off = resolveScope({ role: 'MEMBER', scopingEnabled: false, selfClickupId: null, memberships: [], teamClients: [], teamMembers: [] });
    await expect(svc([]).assertTasks(off, ['t1'])).rejects.toThrow(ForbiddenException);
  });
  it('entries: allows only entries whose task is on a lead client', async () => {
    await expect(svc([{ taskId: 't2', scopeClientOptionId: 'bolt' }]).assertEntries(lead, ['e0'])).rejects.toThrow(ForbiddenException);
  });
});
