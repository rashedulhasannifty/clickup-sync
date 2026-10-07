import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsApi, type CompanyDocumentsParams, type UpdateInput, type UploadInput } from '../api/documents';

export function useEmployeeDocuments(employeeId: string) {
  return useQuery({
    queryKey: ['documents', 'employee', employeeId],
    queryFn: () => documentsApi.listForEmployee(employeeId),
    // A 503 means "not configured": retrying can't fix it.
    retry: (count, err) => (err as { response?: { status?: number } })?.response?.status !== 503 && count < 2,
  });
}

export function useCompanyDocuments(params: CompanyDocumentsParams) {
  return useQuery({
    queryKey: ['documents', 'company', params],
    queryFn: () => documentsApi.listCompany(params),
    placeholderData: keepPreviousData,
    retry: (count, err) => (err as { response?: { status?: number } })?.response?.status !== 503 && count < 2,
  });
}

/** Every write refreshes both views: the employee tab, and the company list with its counts. */
export function useDocumentMutations(employeeId: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['documents'] });
  return {
    upload: useMutation({ mutationFn: (input: UploadInput) => documentsApi.upload(employeeId, input), onSuccess: done }),
    replace: useMutation({
      mutationFn: ({ id, file, expiresOn }: { id: string; file: File; expiresOn?: string }) => documentsApi.replace(id, file, expiresOn),
      onSuccess: done,
    }),
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: UpdateInput }) => documentsApi.update(id, patch), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => documentsApi.remove(id), onSuccess: done }),
  };
}
