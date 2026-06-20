import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { auditLogApi } from '../api/auditLog';
import type { AuditLogQuery } from '../api/auditLog';

export function useAuditLog(query: AuditLogQuery = {}) {
  return useQuery({
    queryKey: ['audit-log', query],
    queryFn: () => auditLogApi.list(query),
    refetchInterval: 30_000,
    // Keep the prior page visible while the next page / filtered result loads,
    // so paging doesn't flash the skeleton on every click.
    placeholderData: keepPreviousData,
  });
}
