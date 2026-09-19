import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { AccessSummary, Role } from '../api/auth';

/** Route/section guard. Renders children only if the user meets `min` role. */
export function RequireRole({ min, children, redirect }: { min: Role; children: React.ReactNode; redirect?: string }) {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole(min)) return redirect ? <Navigate to={redirect} replace /> : null;
  return <>{children}</>;
}

/**
 * Route/section guard driven by the `/auth/me` access summary rather than
 * role alone (team-scoped access — see the design spec's "Navigation and
 * session payload" section). A missing `access` (still loading, an older
 * cached session, or scoping simply off) is never treated as denied — it's
 * treated as unrestricted, same as every other consumer's `?? true` default
 * (Sidebar, CommandPalette, etc.) — only `loading` blocks rendering, and only
 * a genuinely-loaded `access` that fails `when` redirects.
 */
export function RequireAccess({
  when, redirect, children,
}: {
  when: (a: AccessSummary) => boolean;
  redirect: string;
  children: React.ReactNode;
}) {
  const { access, loading } = useAuth();
  if (loading) return null;
  if (access && !when(access)) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}
