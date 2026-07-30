import { ClickupClient } from '../src/clickup/clickup.client';

function clientWith(responses: Record<string, any>) {
  const http = {} as any;
  const settings = { getApiToken: () => 'pk_test', getTeamId: () => '3450636' } as any;
  const c = new ClickupClient(http, settings);
  (c as any).request = jest.fn((_m: string, path: string) => Promise.resolve(responses[path] ?? {}));
  return c;
}

describe('getSpaceListCatalog', () => {
  it('projects name/folder/space/dates and OR-accumulates archived across states', async () => {
    const c = clientWith({
      '/space/s1/list?archived=false': { lists: [{ id: 'lf', name: 'Folderless', start_date: '1751328000000', due_date: null, space: { id: 's1', name: 'X' } }] },
      '/space/s1/list?archived=true': { lists: [] },
      '/space/s1/folder?archived=false': { folders: [{ id: 'f1' }] },
      '/space/s1/folder?archived=true': { folders: [] },
      '/folder/f1/list?archived=false': { lists: [{ id: 'l1', name: 'Sprint 1', folder: { id: 'f1', name: 'X Sprint' }, space: { id: 's1', name: 'X' } }] },
      '/folder/f1/list?archived=true': { lists: [{ id: 'l1', name: 'Sprint 1', folder: { id: 'f1', name: 'X Sprint' }, space: { id: 's1', name: 'X' } }] },
    });
    const cat = await c.getSpaceListCatalog('s1');
    const l1 = cat.find((e: any) => e.id === 'l1')!;
    expect(l1.archived).toBe(true);          // seen in archived=true folder-list scan
    expect(l1.folderName).toBe('X Sprint');
    const lf = cat.find((e: any) => e.id === 'lf')!;
    expect(lf.archived).toBe(false);
    expect(lf.startDate).toEqual(new Date(1751328000000));
    expect(lf.dueDate).toBeNull();
  });
});
