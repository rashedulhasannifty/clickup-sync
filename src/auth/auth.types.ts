import { Role } from '@prisma/client';

export { Role };

/** Identity attached to every authenticated request by AuthGuard. */
export interface AuthPrincipal {
  userId: string;   // 'machine' for the x-admin-key principal
  orgId: string;
  role: Role;
  email: string | null;
  isMachine: boolean;
}
