import { AuthPrincipal } from '../auth/auth.types';

/** Parse a stringified BigInt route param (`:id`) into a bigint. */
export function parseId(id: string): bigint {
  return BigInt(id);
}

/**
 * Attribution label for `updatedBy` derived from the authenticated session —
 * not the previously-spoofable `x-admin-user` header. Machine (admin-key)
 * principals have no email, so fall back to a stable machine label.
 */
export function actorLabel(user: AuthPrincipal): string {
  return user?.email ?? (user?.isMachine ? 'machine-key' : user?.userId) ?? 'unknown';
}
