import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi, type InvitePayload } from '../api/users';
import type { Role } from '../api/auth';
import { useAuth } from './useAuth';

export function useOrgUsers() {
  return useQuery({ queryKey: ['org-users'], queryFn: usersApi.list });
}
export function useInvites() {
  return useQuery({ queryKey: ['org-invites'], queryFn: usersApi.listInvites });
}
export function useUserMutations() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const inv = () => { void qc.invalidateQueries({ queryKey: ['org-users'] }); void qc.invalidateQueries({ queryKey: ['org-invites'] }); };
  // A team assignment on invite/link changes the caller's own access the moment
  // it takes effect (accept, or an existing user linked/added) — same rule as
  // useTeamMutations. Cheap no-op otherwise, so it's fine to always refresh.
  const invAndRefresh = () => { inv(); void refresh(); };
  return {
    invite: useMutation({ mutationFn: (payload: InvitePayload) => usersApi.invite(payload), onSuccess: invAndRefresh }),
    changeRole: useMutation({ mutationFn: ({ id, role }: { id: string; role: Role }) => usersApi.changeRole(id, role), onSuccess: inv }),
    setStatus: useMutation({ mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DISABLED' }) => usersApi.setStatus(id, status), onSuccess: inv }),
    setClickupUser: useMutation({
      mutationFn: ({ id, clickupUserId }: { id: string; clickupUserId: string | null }) => usersApi.setClickupUser(id, clickupUserId),
      onSuccess: invAndRefresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => usersApi.remove(id), onSuccess: inv }),
    resend: useMutation({ mutationFn: (id: string) => usersApi.resendInvite(id), onSuccess: inv }),
    revoke: useMutation({ mutationFn: (id: string) => usersApi.revokeInvite(id), onSuccess: inv }),
  };
}
