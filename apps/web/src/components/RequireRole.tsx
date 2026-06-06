import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../api/auth';

/** Route/section guard. Renders children only if the user meets `min` role. */
export function RequireRole({ min, children, redirect }: { min: Role; children: React.ReactNode; redirect?: string }) {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole(min)) return redirect ? <Navigate to={redirect} replace /> : null;
  return <>{children}</>;
}
