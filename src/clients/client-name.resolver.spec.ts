import { ClientNameResolver } from './client-name.resolver';

const repoWith = (entries: [string, string][]) => ({
  nameByOptionId: jest.fn().mockResolvedValue(new Map(entries)),
});

describe('ClientNameResolver', () => {
  it('replaces a stale payload label with the catalog name for the same option id', async () => {
    const repo = repoWith([['opt-1', 'Douglas L McClelland']]);
    const resolver = new ClientNameResolver(repo as never);
    // The task payload still carries the pre-rename label.
    expect(await resolver.canonical('opt-1', 'Platinum Lawyers')).toBe('Douglas L McClelland');
  });

  it('keeps the payload name when the catalog has no such option', async () => {
    const resolver = new ClientNameResolver(repoWith([]) as never);
    expect(await resolver.canonical('unknown', 'Acme')).toBe('Acme');
  });

  it('keeps the payload name when there is no option id at all', async () => {
    const repo = repoWith([['opt-1', 'Acme']]);
    const resolver = new ClientNameResolver(repo as never);
    expect(await resolver.canonical(null, 'Free text client')).toBe('Free text client');
    expect(repo.nameByOptionId).not.toHaveBeenCalled();
  });

  it('loads the catalog once for a batch, and once more after invalidate()', async () => {
    const repo = repoWith([['opt-1', 'Acme']]);
    const resolver = new ClientNameResolver(repo as never);
    await Promise.all([
      resolver.canonical('opt-1', 'x'),
      resolver.canonical('opt-1', 'x'),
      resolver.canonical('opt-1', 'x'),
    ]);
    expect(repo.nameByOptionId).toHaveBeenCalledTimes(1);
    resolver.invalidate();
    await resolver.canonical('opt-1', 'x');
    expect(repo.nameByOptionId).toHaveBeenCalledTimes(2);
  });

  it('falls back to the payload name when the catalog cannot be read', async () => {
    // A sync must not fail because the name might be slightly stale.
    const repo = { nameByOptionId: jest.fn().mockRejectedValue(new Error('db down')) };
    const resolver = new ClientNameResolver(repo as never);
    expect(await resolver.canonical('opt-1', 'Acme')).toBe('Acme');
  });

  it('retries the load after a failure rather than caching the failure', async () => {
    const repo = {
      nameByOptionId: jest
        .fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue(new Map([['opt-1', 'Acme']])),
    };
    const resolver = new ClientNameResolver(repo as never);
    expect(await resolver.canonical('opt-1', 'stale')).toBe('stale');
    expect(await resolver.canonical('opt-1', 'stale')).toBe('Acme');
  });
});
