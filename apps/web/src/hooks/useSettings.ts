import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi, type SettingsPatch } from '../api/settings';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => settingsApi.update(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}
