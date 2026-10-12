import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exitsApi,
  type ClearanceItemPatch,
  type CompleteExitBody,
  type ExitChecklistGroup,
  type ExitListFilter,
  type InterviewBody,
  type LetterKind,
  type StartExitBody,
  type UpdateExitBody,
} from '../api/exits';
import { peopleApi } from '../api/people';

/** Everything under People shares one root, so an exit write also refreshes the employee, directory and documents. */
const ROOT = ['people'] as const;

export function useEmployeeExit(employeeId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, 'exit', employeeId],
    queryFn: () => exitsApi.forEmployee(employeeId as string),
    enabled: !!employeeId,
  });
}

/** The employee record, for the start-offboarding form when there is no exit yet. */
export function useExitEmployee(employeeId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, 'exit-employee', employeeId],
    queryFn: () => peopleApi.employee(employeeId as string),
    enabled: !!employeeId,
  });
}

export function useExits(status?: ExitListFilter) {
  return useQuery({ queryKey: [...ROOT, 'exits', status ?? 'all'], queryFn: () => exitsApi.list(status) });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOT });
}

export function useStartExit(employeeId: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: StartExitBody) => exitsApi.start(employeeId, body), onSuccess: refresh });
}

export function useUpdateExit(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: UpdateExitBody) => exitsApi.update(id, body), onSuccess: refresh });
}

export function useSaveInterview(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: InterviewBody) => exitsApi.saveInterview(id, body), onSuccess: refresh });
}

export function useAddClearanceItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ label, group }: { label: string; group: ExitChecklistGroup }) => exitsApi.addItem(id, label, group),
    onSuccess: refresh,
  });
}

export function useUpdateClearanceItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: ClearanceItemPatch }) =>
      exitsApi.updateItem(id, itemId, patch),
    onSuccess: refresh,
  });
}

export function useRemoveClearanceItem(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (itemId: string) => exitsApi.removeItem(id, itemId), onSuccess: refresh });
}

export function useGenerateLetter(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (kind: LetterKind) => exitsApi.generateLetter(id, kind), onSuccess: refresh });
}

export function useAdvanceExit(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => exitsApi.advance(id), onSuccess: refresh });
}

export function useCompleteExit(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: CompleteExitBody) => exitsApi.complete(id, body), onSuccess: refresh });
}

export function useCancelExit(id: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (note: string) => exitsApi.cancel(id, note), onSuccess: refresh });
}
