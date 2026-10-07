import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appraisalsApi,
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
