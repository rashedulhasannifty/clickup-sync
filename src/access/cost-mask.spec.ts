import { resolveScope } from './access-scope';
import { maskCost } from './cost-mask';

const lead = resolveScope({
  role: 'MEMBER',
  scopingEnabled: true,
  selfClickupId: null,
  memberships: [
    { teamId: 'A', role: 'LEAD' },
    { teamId: 'B', role: 'MEMBER' },
  ],
  teamClients: [
    { teamId: 'A', optionId: 'acme' },
    { teamId: 'B', optionId: 'bolt' },
  ],
  teamMembers: [],
});

describe('maskCost', () => {
  const row = {
    id: 'e1',
    durationHours: 2,
    costCents: 5000n,
    hourlyRateCents: 2500n,
    rateId: 7n,
    currency: 'USD',
  };

  it('keeps cost on a LEAD client', () => {
    expect(maskCost(row, lead, 'acme')).toEqual(row);
  });

  it('nulls every cost field on a MEMBER client, keeps hours and the currency label', () => {
    expect(maskCost(row, lead, 'bolt')).toEqual({
      ...row,
      costCents: null,
      hourlyRateCents: null,
      rateId: null,
    });
  });

  it('masks the task cost + estimation custom fields for members, keeps them for leads', () => {
    const task = { taskId: 't', cost: 10, estimation: 8, sprintPoints: 3 };
    expect(maskCost(task, lead, 'bolt')).toEqual({
      taskId: 't',
      cost: null,
      estimation: null,
      sprintPoints: 3,
    });
    expect(maskCost(task, lead, 'acme')).toEqual(task);
  });
});
