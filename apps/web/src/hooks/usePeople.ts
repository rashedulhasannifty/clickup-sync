import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  peopleApi,
  type AddEventBody,
  type CreateEmployeeBody,
  type EmployeeListParams,
  type LeaveListParams,
  type UpdateEmployeeBody,
} from '../api/people';

/** Everything under People shares one root so a write can refresh the lot. */
const ROOT = ['people'] as const;

export function useEmployees(params: EmployeeListParams) {
  return useQuery({ queryKey: [...ROOT, 'employees', params], queryFn: () => peopleApi.employees(params) });
}

export function useEmployeeSummary(id: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, 'summary', id],
    queryFn: () => peopleApi.summary(id as string),
    enabled: !!id,
  });
}

export function useTodayAttendance() {
  return useQuery({
    queryKey: [...ROOT, 'today'],
    queryFn: peopleApi.today,
    // The door log moves through the day; keep it fresh without a manual reload.
    refetchInterval: 60_000,
  });
}

export function useLeaves(params: LeaveListParams) {
  return useQuery({ queryKey: [...ROOT, 'leaves', params], queryFn: () => peopleApi.leaves(params) });
}

function useInvalidatePeople() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOT });
}

export function useCreateEmployee() {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (body: CreateEmployeeBody) => peopleApi.create(body), onSuccess: invalidate });
}

export function useUpdateEmployee(id: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (body: UpdateEmployeeBody) => peopleApi.update(id, body), onSuccess: invalidate });
}

export function useAddEmploymentEvent(id: string) {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (body: AddEventBody) => peopleApi.addEvent(id, body), onSuccess: invalidate });
}

export function useImportFromUsers() {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: peopleApi.importFromUsers, onSuccess: invalidate });
}

/**
 * Enqueues a sync job (202). The rows land when the worker finishes, so
 * refresh now and once more shortly after rather than claiming it is done.
 */
export function useSyncAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lookbackDays?: number) => peopleApi.syncAttendance(lookbackDays),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ROOT });
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: ROOT }), 5000);
    },
  });
}

export function useDecideLeave() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      peopleApi.decideLeave(id, status),
    onSuccess: invalidate,
  });
}
