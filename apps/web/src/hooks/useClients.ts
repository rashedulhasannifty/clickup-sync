import { useQuery } from '@tanstack/react-query';
import { clientsApi, type ClientOverviewParams } from '../api/clients';

/** Clients page data. Lifetime-wide by design — there is no date window, so the
 *  only cache keys are the space/archived/sort filters. */
export function useClientsOverview(params: ClientOverviewParams = {}) {
  return useQuery({
    queryKey: ['clients-overview', params.spaceId ?? null, params.archived ?? null, params.sort ?? 'name'],
    queryFn: () => clientsApi.overview(params),
  });
}
