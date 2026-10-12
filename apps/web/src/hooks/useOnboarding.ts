import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onboardingApi, type OnboardingGroup, type OnboardingItemPatch, type OnboardingView } from '../api/onboarding';

const key = (employeeId: string) => ['people', 'onboarding', employeeId] as const;

export function useOnboarding(employeeId: string) {
  return useQuery({ queryKey: key(employeeId), queryFn: () => onboardingApi.get(employeeId) });
}

/**
 * Every write returns the whole checklist, so the cache is set from the response. The directory's
 * "Onboarding 12/28" badge and the Documents tab (a link can follow an upload) are refreshed too.
 */
export function useOnboardingMutations(employeeId: string) {
  const qc = useQueryClient();
  const done = (view: OnboardingView) => {
    qc.setQueryData(key(employeeId), view);
    void qc.invalidateQueries({ queryKey: ['people', 'employees'] });
    void qc.invalidateQueries({ queryKey: ['documents'] });
  };
  return {
    start: useMutation({ mutationFn: () => onboardingApi.start(employeeId), onSuccess: done }),
    add: useMutation({
      mutationFn: ({ group, label }: { group: OnboardingGroup; label: string }) => onboardingApi.addItem(employeeId, group, label),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ itemId, patch }: { itemId: string; patch: OnboardingItemPatch }) => onboardingApi.updateItem(employeeId, itemId, patch),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (itemId: string) => onboardingApi.removeItem(employeeId, itemId), onSuccess: done }),
  };
}
