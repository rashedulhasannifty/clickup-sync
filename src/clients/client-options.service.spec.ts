import { extractClientOptions, ClientOptionsService } from './client-options.service';

const field = (over: object = {}) => ({
  id: 'f1',
  name: 'Client',
  type: 'drop_down',
  type_config: {
    options: [
      { id: 'o1', name: 'Acme', orderindex: 0 },
      { id: 'o2', name: '  Bolt ', orderindex: 1 },
      { id: 'o3', name: '' },
    ],
  },
  ...over,
});

describe('extractClientOptions', () => {
  it('takes drop_down fields named Client (case-insensitive), trims names, skips empty', () => {
    expect(extractClientOptions([field(), field({ id: 'f2', name: 'Department' })] as any)).toEqual([
      { fieldId: 'f1', optionId: 'o1', name: 'Acme' },
      { fieldId: 'f1', optionId: 'o2', name: 'Bolt' },
    ]);
  });
  it('ignores a non-dropdown field called client', () => {
    expect(extractClientOptions([field({ type: 'short_text' })] as any)).toEqual([]);
  });
});

describe('ClientOptionsService.syncSpace', () => {
  it('upserts per field from workspace + space fields, deduped by field id', async () => {
    const clickup = {
      getWorkspaceFields: jest.fn().mockResolvedValue([field()]),
      getSpaceFields: jest.fn().mockResolvedValue([field()]),
    };
    const repo = { upsertForField: jest.fn().mockResolvedValue({ upserted: 2, archived: 0 }) };
    const settings = { getTeamId: () => 'team' };
    const svc = new ClientOptionsService(clickup as any, repo as any, settings as any);
    await svc.syncSpace('s1');
    expect(repo.upsertForField).toHaveBeenCalledTimes(1);
    expect(repo.upsertForField).toHaveBeenCalledWith('f1', [
      { optionId: 'o1', name: 'Acme' },
      { optionId: 'o2', name: 'Bolt' },
    ]);
  });
});
