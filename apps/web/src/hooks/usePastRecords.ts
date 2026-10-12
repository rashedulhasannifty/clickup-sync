import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pastRecordsApi, type PastRecordBody, type PastRecordRow } from '../api/pastRecords';

/**
 * A past record changes the employee (status, designation, gross, dates) and
 * what is due next, so every write refreshes People and Appraisals.
 */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['people'] }),
      qc.invalidateQueries({ queryKey: ['appraisals'] }),
      qc.invalidateQueries({ queryKey: ['past-records'] }),
    ]);
}

export function usePastRecords(employeeId: string) {
  return useQuery({
    queryKey: ['past-records', employeeId],
    queryFn: () => pastRecordsApi.list(employeeId),
  });
}

export function usePastRecordMutations(employeeId: string) {
  const invalidate = useInvalidate();
  return {
    add: useMutation({ mutationFn: (body: PastRecordBody) => pastRecordsApi.add(employeeId, body), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ recordId, body }: { recordId: string; body: PastRecordBody }) =>
        pastRecordsApi.update(employeeId, recordId, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (recordId: string) => pastRecordsApi.remove(employeeId, recordId),
      onSuccess: invalidate,
    }),
  };
}

export function usePastRecordsImport() {
  const invalidate = useInvalidate();
  return {
    preview: useMutation({ mutationFn: (rows: PastRecordRow[]) => pastRecordsApi.preview(rows) }),
    apply: useMutation({ mutationFn: (rows: PastRecordRow[]) => pastRecordsApi.apply(rows), onSuccess: invalidate }),
  };
}
