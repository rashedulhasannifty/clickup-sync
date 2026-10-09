import { ConflictException } from '@nestjs/common';

export const EXITED_READONLY_MESSAGE =
  'This employee has exited; their record is read-only.';

/**
 * The single "an exited employee is read-only" check, shared by the People and Documents modules.
 * Reads are never guarded; the exit module's own writes and generated exit letters bypass it by
 * going through their own methods.
 */
export function assertNotExited(employee: { status: string }): void {
  if (employee.status === 'EXITED')
    throw new ConflictException(EXITED_READONLY_MESSAGE);
}
