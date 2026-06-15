import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clickupMembersApi, type ClickupMember } from '../api/clickup-members';

const TEN_MIN = 10 * 60 * 1000;

export function useClickupMembers() {
  const query = useQuery({
    queryKey: ['clickup-members'],
    queryFn: clickupMembersApi.list,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN,
    retry: 1,
  });

  const members: ClickupMember[] = useMemo(() => query.data ?? [], [query.data]);

  const { byId, byEmail, byName } = useMemo(() => {
    const byId = new Map<string, ClickupMember>();
    const byEmail = new Map<string, ClickupMember>();
    const byName = new Map<string, ClickupMember>();
    for (const m of members) {
      byId.set(m.id, m);
      if (m.email) byEmail.set(m.email.toLowerCase(), m);
      if (m.name) byName.set(m.name.toLowerCase(), m);
    }
    return { byId, byEmail, byName };
  }, [members]);

  return { members, byId, byEmail, byName, isLoading: query.isLoading };
}
