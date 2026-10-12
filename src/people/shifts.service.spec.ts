import { BadRequestException, ConflictException } from '@nestjs/common';
import { dhakaInstant } from './people-dates';
import { ShiftsService, toShiftView } from './shifts.service';

const shift = (over = {}) => ({
  id: 's1',
  name: 'Evening',
  startMinutes: 840,
  endMinutes: 1380,
  graceMinutes: 15,
  trackPunctuality: true,
  _count: { employees: 3 },
  ...over,
});

function make() {
  const repo = {
    list: jest.fn().mockResolvedValue([shift()]),
    find: jest.fn().mockResolvedValue(shift()),
    create: jest.fn().mockImplementation((_o, d) => Promise.resolve(shift(d))),
    update: jest.fn().mockImplementation((_id, d) => Promise.resolve(shift(d))),
    delete: jest.fn().mockResolvedValue(undefined),
    countEmployeesInOrg: jest.fn().mockResolvedValue(1),
    assign: jest.fn().mockResolvedValue(1),
    employeesWithRealFirstIns: jest.fn().mockResolvedValue([]),
  };
  return { svc: new ShiftsService(repo as never), repo };
}

describe('ShiftsService', () => {
  it('views carry labels, length and the assigned count', () => {
    expect(toShiftView(shift())).toMatchObject({
      start: '14:00',
      end: '23:00',
      lengthHours: 9,
      assignedCount: 3,
    });
  });

  it('refuses a zero-length shift and maps a duplicate name to 409', async () => {
    const { svc, repo } = make();
    await expect(
      svc.create('o', { name: 'X', startMinutes: 600, endMinutes: 600 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.update('o', 's1', { startMinutes: 1380 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    repo.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      svc.create('o', { name: 'Evening', startMinutes: 840, endMinutes: 1380 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('assign checks every employee and shift belongs to the org', async () => {
    const { svc, repo } = make();
    await expect(
      svc.assign('o', { assignments: [{ employeeId: 'e1', shiftId: 'nope' }] }),
    ).rejects.toThrow('Unknown shift');
    repo.countEmployeesInOrg.mockResolvedValueOnce(0);
    await expect(
      svc.assign('o', { assignments: [{ employeeId: 'eX', shiftId: 's1' }] }),
    ).rejects.toThrow('Unknown employee');
    await expect(
      svc.assign('o', {
        assignments: [
          { employeeId: 'e1', shiftId: 's1' },
          { employeeId: 'e1', shiftId: null },
        ],
      }),
    ).rejects.toThrow('only once');
    await expect(
      svc.assign('o', { assignments: [{ employeeId: 'e1', shiftId: null }] }),
    ).resolves.toEqual({ updated: 1 });
    expect(repo.assign).toHaveBeenLastCalledWith('o', [
      { employeeId: 'e1', shiftId: null },
    ]);
  });

  it('suggestions use business-day first-ins only and never write', async () => {
    const { svc, repo } = make();
    const att = (date: string, min: number) => ({
      date: new Date(`${date}T00:00:00Z`),
      firstIn: dhakaInstant(date, min),
    });
    repo.employeesWithRealFirstIns.mockResolvedValue([
      {
        id: 'e1',
        fullName: 'Test A',
        shiftId: null,
        attendances: [
          att('2026-10-05', 845),
          att('2026-10-06', 850),
          att('2026-10-07', 835),
          att('2026-10-08', 840),
          att('2026-10-09', 842),
          // Saturday: ignored.
          att('2026-10-10', 300),
        ],
      },
    ]);
    const r = await svc.suggestions('o', { from: '2026-10-01', to: '2026-10-12' });
    expect(r.suggestions).toEqual([
      expect.objectContaining({ employeeId: 'e1', proposedShiftId: 's1', sampleDays: 5, changes: true }),
    ]);
    expect(repo.assign).not.toHaveBeenCalled();
  });
});
