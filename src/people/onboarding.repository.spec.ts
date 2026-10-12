import { EmployeesRepository } from './employees.repository';
import { OnboardingRepository } from './onboarding.repository';

describe('seeding the joining checklist', () => {
  it('creating an employee (POST and import-from-users both go through here) seeds 28 items in the same nested write', async () => {
    const create = jest.fn().mockResolvedValue({});
    const repo = new EmployeesRepository({ employee: { create } } as never);
    await repo.create({
      orgId: 'org',
      fullName: 'Ada',
      email: 'ada@x.test',
      employeeCode: null,
      userId: null,
      clickupUserId: null,
      designation: 'Engineer',
      grade: null,
      department: null,
      teamId: null,
      managerId: null,
      joinDate: '2026-10-01',
      createdBy: null,
    });
    expect(create).toHaveBeenCalledTimes(1);
    const seeded = create.mock.calls[0][0].data.onboarding.create;
    expect(seeded).toHaveLength(28);
    expect(seeded[0]).toEqual({
      key: 'doc_resume',
      group: 'DOCUMENTS',
      label: expect.any(String),
      position: 0,
    });
  });

  it('start seeds with skipDuplicates (idempotent), after any existing items', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      onboardingItem: {
        aggregate: jest.fn().mockResolvedValue({ _max: { position: 30 } }),
        createMany,
      },
    };
    const repo = new OnboardingRepository(prisma as never);
    expect(await repo.seedDefaults('e1')).toBe(0);
    const arg = createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(28);
    expect(arg.data[0]).toMatchObject({
      employeeId: 'e1',
      key: 'doc_resume',
      position: 31,
    });
  });

  it('progressFor short-circuits an empty list and maps rows to { resolved, total }', async () => {
    const $queryRaw = jest
      .fn()
      .mockResolvedValue([{ employee_id: 'e1', total: 28, resolved: 12 }]);
    const repo = new OnboardingRepository({ $queryRaw } as never);
    expect((await repo.progressFor([])).size).toBe(0);
    expect($queryRaw).not.toHaveBeenCalled();
    expect((await repo.progressFor(['e1', 'e2'])).get('e1')).toEqual({
      resolved: 12,
      total: 28,
    });
  });
});
