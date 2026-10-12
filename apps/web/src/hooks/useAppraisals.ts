import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appraisalsApi,
  type AppraisalType,
  type AppraisalView,
  type CreateCycleBody,
  type UpdateAppraisalBody,
  type UpdateCycleBody,
} from '../api/appraisals';

/** Everything under appraisals shares one root so a write can refresh the lot. */
const ROOT = ['appraisals'] as const;

export function useCycles() {
  return useQuery({ queryKey: [...ROOT, 'cycles'], queryFn: appraisalsApi.cycles });
}

/** Who is due a `type` appraisal in [from, to]. Pass null to disable (e.g. while dates are incomplete). */
export function useDueAppraisals(params: { type: AppraisalType; from: string; to: string } | null) {
  return useQuery({
    queryKey: [...ROOT, 'due', params?.type, params?.from, params?.to],
    queryFn: () => {
      const p = params as { type: AppraisalType; from: string; to: string };
      return appraisalsApi.due(p.type, p.from, p.to);
    },
    enabled: !!params,
  });
}

/** Everyone overdue for any appraisal type as of today. */
export function useOverdueAppraisals() {
  return useQuery({ queryKey: [...ROOT, 'overdue'], queryFn: appraisalsApi.overdue });
}

export function useCycleAppraisals(cycleId: string | null) {
  return useQuery({
    queryKey: [...ROOT, 'cycle', cycleId, 'appraisals'],
    queryFn: () => appraisalsApi.cycleAppraisals(cycleId as string),
    enabled: !!cycleId,
  });
}

export function useAppraisal(id: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, 'appraisal', id],
    queryFn: () => appraisalsApi.appraisal(id as string),
    enabled: !!id,
  });
}

export function useEmployeeAppraisals(employeeId: string | undefined) {
  return useQuery({
    queryKey: [...ROOT, 'employee', employeeId],
    queryFn: () => appraisalsApi.forEmployee(employeeId as string),
    enabled: !!employeeId,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOT });
}

/** An advance can write an employment event (promotion), so refresh the People data too. */
function useInvalidatePeopleToo() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ROOT });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };
}

export function useCreateCycle() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (b: CreateCycleBody) => appraisalsApi.createCycle(b), onSuccess: invalidate });
}

export function useUpdateCycle(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (b: UpdateCycleBody) => appraisalsApi.updateCycle(id, b), onSuccess: invalidate });
}

/** Creates a cycle and launches it for the given employees in one go (the create dialog's "Create and launch"). */
export function useCreateAndLaunch() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ body, employeeIds }: { body: CreateCycleBody; employeeIds: string[] }) => {
      const cycle = await appraisalsApi.createCycle(body);
      try {
        return { cycle, result: await appraisalsApi.launch(cycle.id, employeeIds) };
      } finally {
        // Even when the launch fails the cycle exists: refresh so it shows up.
        void invalidate();
      }
    },
    onSuccess: invalidate,
  });
}

export function useLaunchCycle(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (ids?: string[]) => appraisalsApi.launch(id, ids), onSuccess: invalidate });
}

/** The mutations on one appraisal; each returns the fresh view, which is written straight into the cache. */
export function useAppraisalMutations(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const invalidatePeople = useInvalidatePeopleToo();
  const put = (v: AppraisalView) => {
    qc.setQueryData([...ROOT, 'appraisal', id], v);
    invalidate();
  };
  return {
    save: useMutation({ mutationFn: (b: UpdateAppraisalBody) => appraisalsApi.update(id, b), onSuccess: put }),
    advance: useMutation({
      mutationFn: () => appraisalsApi.advance(id),
      onSuccess: (v) => {
        put(v);
        invalidatePeople();
      },
    }),
    sendBack: useMutation({ mutationFn: () => appraisalsApi.sendBack(id), onSuccess: put }),
    refreshKpis: useMutation({ mutationFn: () => appraisalsApi.refreshKpis(id), onSuccess: put }),
  };
}
