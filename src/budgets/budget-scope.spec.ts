import { leadBudgetClientNames } from './budget-scope';

describe('leadBudgetClientNames', () => {
  const opts = [
    { optionId: 'o1', name: 'Acme', teamId: 'A' },
    { optionId: 'o2', name: 'Acme', teamId: 'A' }, // same name, same team: fine
    { optionId: 'o3', name: 'Shared', teamId: 'A' },
    { optionId: 'o4', name: 'Shared', teamId: 'B' }, // same name, different team: ambiguous
  ];
  it('returns names of lead options, excluding names owned by another team', () => {
    expect([...leadBudgetClientNames(['o1', 'o2', 'o3'], opts, ['A'])]).toEqual(['Acme']);
  });

  it('returns an empty set when the lead has no option ids', () => {
    expect([...leadBudgetClientNames([], opts, ['A'])]).toEqual([]);
  });

  it('never widens: an option not in leadOptionIds contributes nothing even if unambiguous', () => {
    const result = leadBudgetClientNames(['o1'], opts, ['A']);
    expect([...result]).toEqual(['Acme']);
    expect(result.has('Shared')).toBe(false);
  });
});
