import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './decorators';

function ctx(user: any, required?: Role[]) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
    key === ROLES_KEY ? required : undefined,
  );
  const execCtx: any = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return { guard: new RolesGuard(reflector), execCtx };
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const { guard, execCtx } = ctx({ role: Role.MEMBER });
    expect(guard.canActivate(execCtx)).toBe(true);
  });
  it('allows when the user role meets the requirement', () => {
    const { guard, execCtx } = ctx({ role: Role.OWNER }, [Role.ADMIN, Role.OWNER]);
    expect(guard.canActivate(execCtx)).toBe(true);
  });
  it('throws Forbidden when role is insufficient', () => {
    const { guard, execCtx } = ctx({ role: Role.MEMBER }, [Role.ADMIN, Role.OWNER]);
    expect(() => guard.canActivate(execCtx)).toThrow();
  });
});
