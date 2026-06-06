import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/users';
import type { Role } from '../api/auth';

export function useOrgUsers() {
  return useQuery({ queryKey: ['org-users'], queryFn: usersApi.list });
}
export function useInvites() {
  return useQuery({ queryKey: ['org-invites'], queryFn: usersApi.listInvites });
}
export function useUserMutations() {
  const qc = useQueryClient();
  const inv = () => { void qc.invalidateQueries({ queryKey: ['org-users'] }); void qc.invalidateQueries({ queryKey: ['org-invites'] }); };
  return {
    invite: useMutation({ mutationFn: ({ email, role }: { email: string; role: Role }) => usersApi.invite(email, role), onSuccess: inv }),
    changeRole: useMutation({ mutationFn: ({ id, role }: { id: string; role: Role }) => usersApi.changeRole(id, role), onSuccess: inv }),
    setStatus: useMutation({ mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DISABLED' }) => usersApi.setStatus(id, status), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => usersApi.remove(id), onSuccess: inv }),
    resend: useMutation({ mutationFn: (id: string) => usersApi.resendInvite(id), onSuccess: inv }),
    revoke: useMutation({ mutationFn: (id: string) => usersApi.revokeInvite(id), onSuccess: inv }),
  };
}
