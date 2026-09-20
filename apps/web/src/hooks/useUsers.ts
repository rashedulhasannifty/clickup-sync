import { useRef } from 'react';
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
/** The ClickUp workspace directory behind the Users page's "ClickUp" tab.
 *  The server caches it for ~10 min; `refetch()` passes `refresh=true` so the
 *  Refresh button actually re-reads ClickUp. */
export function useClickupDirectory(enabled = true) {
  // A ref, not state: `refresh()` sets it and calls refetch() in the same tick,
  // and the queryFn closure would still see the old value of a state variable.
  const forceRefresh = useRef(false);
  const query = useQuery({
    queryKey: ['clickup-directory'],
    queryFn: async () => {
      const bust = forceRefresh.current;
      forceRefresh.current = false;
      return usersApi.listClickupMembers(bust);
    },
    enabled,
  });
  const refresh = async () => {
    forceRefresh.current = true;
    try {
      await query.refetch();
    } finally {
      // A failed refetch must not leave the flag armed for the next background
      // refocus fetch, which would hit ClickUp when nobody asked.
      forceRefresh.current = false;
    }
  };
  return { ...query, refresh };
}

export function useUserMutations() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const inv = () => { void qc.invalidateQueries({ queryKey: ['org-users'] }); void qc.invalidateQueries({ queryKey: ['org-invites'] }); };
  // A team assignment on invite/link changes the caller's own access the moment
  // it takes effect (accept, or an existing user linked/added) — same rule as
  // useTeamMutations. Cheap no-op otherwise, so it's fine to always refresh.
  const invAndRefresh = () => { inv(); void refresh(); };
  // Mirrors useTeamMutations' `inv()`, in the inverse direction: an invite,
  // its revoke/resend, or a role change can move the Teams page's
  // pending-invites list and its `membersWithoutTeam` readiness count, so
  // those two must invalidate alongside the Users-page queries above.
  const invTeams = () => { void qc.invalidateQueries({ queryKey: ['teams'] }); void qc.invalidateQueries({ queryKey: ['readiness'] }); };
  // The ClickUp tab's per-row status is derived from accounts + pending
  // invites, so anything that moves those has to re-annotate the directory.
  const invDirectory = () => { void qc.invalidateQueries({ queryKey: ['clickup-directory'] }); };
  return {
    invite: useMutation({ mutationFn: (payload: InvitePayload) => usersApi.invite(payload), onSuccess: () => { invAndRefresh(); invTeams(); invDirectory(); } }),
    changeRole: useMutation({ mutationFn: ({ id, role }: { id: string; role: Role }) => usersApi.changeRole(id, role), onSuccess: () => { inv(); invTeams(); } }),
    setStatus: useMutation({ mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DISABLED' }) => usersApi.setStatus(id, status), onSuccess: inv }),
    setClickupUser: useMutation({
      mutationFn: ({ id, clickupUserId }: { id: string; clickupUserId: string | null }) => usersApi.setClickupUser(id, clickupUserId),
      onSuccess: () => { invAndRefresh(); invDirectory(); },
    }),
    // No cache to invalidate: sending a reset link changes nothing the Users
    // page displays.
    sendPasswordReset: useMutation({ mutationFn: (id: string) => usersApi.sendPasswordReset(id) }),
    remove: useMutation({ mutationFn: (id: string) => usersApi.remove(id), onSuccess: () => { inv(); invDirectory(); } }),
    resend: useMutation({ mutationFn: (id: string) => usersApi.resendInvite(id), onSuccess: () => { inv(); invTeams(); } }),
    revoke: useMutation({ mutationFn: (id: string) => usersApi.revokeInvite(id), onSuccess: () => { inv(); invTeams(); invDirectory(); } }),
  };
}
