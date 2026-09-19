import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teamsApi, type TeamMemberRoleValue } from '../api/teams';
import { useAuth } from './useAuth';

export function useTeams() {
  return useQuery({ queryKey: ['teams'], queryFn: teamsApi.list });
}
export function useClientOptions() {
  return useQuery({ queryKey: ['client-options'], queryFn: teamsApi.clientOptions });
}
export function useReadiness(enabled = true) {
  return useQuery({ queryKey: ['readiness'], queryFn: teamsApi.readiness, enabled });
}
export function useMyTeams() {
  return useQuery({ queryKey: ['my-teams'], queryFn: teamsApi.mine });
}

/**
 * Every mutation here invalidates `['teams']`, `['client-options']` and
 * `['readiness']` (the admin Teams page's data), `['my-teams']` (the
 * lead-facing view of the same memberships/clients), and `['org-users']`
 * (the Users page's team chips) — and refreshes the caller's own `/auth/me`
 * access summary, because adding/removing a membership can change what THIS
 * session is allowed to see right now.
 */
export function useTeamMutations() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const inv = () => {
    void qc.invalidateQueries({ queryKey: ['teams'] });
    void qc.invalidateQueries({ queryKey: ['client-options'] });
    void qc.invalidateQueries({ queryKey: ['readiness'] });
    void qc.invalidateQueries({ queryKey: ['my-teams'] });
    void qc.invalidateQueries({ queryKey: ['org-users'] });
    void refresh();
  };
  return {
    create: useMutation({
      mutationFn: ({ name, optionIds }: { name: string; optionIds: string[] }) => teamsApi.create(name, optionIds),
      onSuccess: inv,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => teamsApi.rename(id, name),
      onSuccess: inv,
    }),
    remove: useMutation({ mutationFn: (id: string) => teamsApi.remove(id), onSuccess: inv }),
    setClients: useMutation({
      mutationFn: ({ id, optionIds, move }: { id: string; optionIds: string[]; move?: boolean }) =>
        teamsApi.setClients(id, optionIds, move),
      onSuccess: inv,
    }),
    addMember: useMutation({
      mutationFn: ({ id, userId, role }: { id: string; userId: string; role: TeamMemberRoleValue }) =>
        teamsApi.addMember(id, userId, role),
      onSuccess: inv,
    }),
    setRole: useMutation({
      mutationFn: ({ id, userId, role }: { id: string; userId: string; role: TeamMemberRoleValue }) =>
        teamsApi.setRole(id, userId, role),
      onSuccess: inv,
    }),
    removeMember: useMutation({
      mutationFn: ({ id, userId }: { id: string; userId: string }) => teamsApi.removeMember(id, userId),
      onSuccess: inv,
    }),
    leadAddMember: useMutation({
      mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => teamsApi.leadAddMember(teamId, userId),
      onSuccess: inv,
    }),
  };
}
