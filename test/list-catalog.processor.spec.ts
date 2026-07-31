import { ListCatalogProcessor } from '../src/workers/list-catalog.processor';

it('processes a SYNC_LIST_CATALOG job by syncing the space catalog', async () => {
  const svc = { syncSpace: jest.fn().mockResolvedValue({ synced: 3 }) } as any;
  const proc = new ListCatalogProcessor(svc);
  const res = await proc.process({ data: { spaceId: 's1' } } as any);
  expect(svc.syncSpace).toHaveBeenCalledWith('s1');
  expect(res).toEqual({ synced: 3 });
});
