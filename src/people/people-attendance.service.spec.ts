import { ConflictException } from '@nestjs/common';
import { PeopleAttendanceService } from './people-attendance.service';

const principal = { orgId: 'org', userId: 'u1', isMachine: false } as never;

function make(employeeStatus: string) {
  const attendance = {
    findLeave: jest.fn().mockResolvedValue({
      id: 'l1',
      status: 'PENDING',
      employee: { fullName: 'Ada', status: employeeStatus },
    }),
    decide: jest.fn().mockResolvedValue(true),
  };
  const svc = new PeopleAttendanceService({} as never, attendance as never, {} as never, {} as never);
  return { svc, attendance };
}

describe('PeopleAttendanceService.decide', () => {
  it('refuses to decide leave for an employee who has exited', async () => {
    const { svc, attendance } = make('EXITED');
    await expect(svc.decide(principal, 'l1', 'APPROVED')).rejects.toBeInstanceOf(ConflictException);
    expect(attendance.decide).not.toHaveBeenCalled();
  });
});
