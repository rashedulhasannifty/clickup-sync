import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '../api/auth';
import type { MeResponse, Role } from '../api/auth';

interface AuthState {
  loading: boolean;
  user: MeResponse['user'] | null;
  org: MeResponse['org'] | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (min: Role) => boolean;
}

const RANK: Record<Role, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<MeResponse['user'] | null>(null);
  const [org, setOrg] = useState<MeResponse['org'] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me.user); setOrg(me.org);
    } catch {
      setUser(null); setOrg(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null); setOrg(null);
    location.href = '/login';
  }, []);

  const hasRole = useCallback((min: Role) => !!user && RANK[user.role] >= RANK[min], [user]);

  return <AuthContext.Provider value={{ loading, user, org, refresh, logout, hasRole }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
