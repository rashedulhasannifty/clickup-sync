import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  peopleApi,
  type AddEventBody,
  type AttendanceImportResult,
  type LeaveImportResult,
  type CreateEmployeeBody,
  type EmployeeListParams,
  type LeaveListParams,
  type HolidayBody,
  type ShiftBody,
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

// --- shifts and Stellar HRM imports ------------------------------------------

export function useShifts() {
  return useQuery({ queryKey: [...ROOT, 'shifts'], queryFn: peopleApi.shifts });
}

export function useCreateShift() {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (body: ShiftBody) => peopleApi.createShift(body), onSuccess: invalidate });
}

export function useUpdateShift() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ShiftBody> }) => peopleApi.updateShift(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteShift() {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (id: string) => peopleApi.deleteShift(id), onSuccess: invalidate });
}

// Holidays change attendance states and every score, so a write refreshes all of People.
export function useHolidays(year: number) {
  return useQuery({ queryKey: [...ROOT, 'holidays', year], queryFn: () => peopleApi.holidays(year) });
}

export function useCreateHoliday() {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (body: HolidayBody) => peopleApi.createHoliday(body), onSuccess: invalidate });
}

export function useUpdateHolidays() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: (body: { ids: string[]; name?: string; tentative?: boolean }) => peopleApi.updateHolidays(body),
    onSuccess: invalidate,
  });
}

export function useDeleteHolidays() {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (ids: string[]) => peopleApi.deleteHolidays(ids), onSuccess: invalidate });
}

export function usePrefillHolidays() {
  const invalidate = useInvalidatePeople();
  return useMutation({ mutationFn: (year: number) => peopleApi.prefillHolidays(year), onSuccess: invalidate });
}

/** Suggestions are computed on demand (button), never polled. */
export function useShiftSuggestions(enabled: boolean) {
  return useQuery({ queryKey: [...ROOT, 'shift-suggestions'], queryFn: peopleApi.shiftSuggestions, enabled });
}

export function useAssignShifts() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: (assignments: { employeeId: string; shiftId: string | null }[]) => peopleApi.assignShifts(assignments),
    onSuccess: invalidate,
  });
}

/** Dry run (preview) or the real import of a Stellar HRM export; only a real import refreshes People. */
export function useStellarImport() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({
      file,
      kind,
      dryRun,
    }: {
      file: File;
      kind: 'attendance' | 'leaves';
      dryRun: boolean;
    }): Promise<AttendanceImportResult | LeaveImportResult> =>
      kind === 'attendance' ? peopleApi.importStellarAttendance(file, dryRun) : peopleApi.importStellarLeaves(file, dryRun),
    onSuccess: (_r, vars) => {
      if (!vars.dryRun) void invalidate();
    },
  });
}
