import { UsersController } from './users.controller';
import type { AuthPrincipal } from './auth.types';

const principal = { id: 'u1', orgId: 'org1', role: 'ADMIN' } as unknown as AuthPrincipal;

function makeController() {
  const list = jest.fn().mockResolvedValue([]);
  const controller = new UsersController({} as any, {} as any, { list } as any);
  return { controller, list };
}

describe('UsersController.clickupMembers', () => {
  it('lists the ClickUp directory for the caller org, using the cache', async () => {
    const { controller, list } = makeController();
    await controller.clickupMembers(principal, undefined);
    expect(list).toHaveBeenCalledWith('org1', { refresh: false });
  });

  it('busts the cache only for an explicit refresh=true', async () => {
    const { controller, list } = makeController();
    await controller.clickupMembers(principal, 'true');
    expect(list).toHaveBeenLastCalledWith('org1', { refresh: true });

    // Anything else is a normal read — a stray `?refresh=0` must not hit ClickUp.
    for (const v of ['false', '0', '', 'yes']) {
      await controller.clickupMembers(principal, v);
      expect(list).toHaveBeenLastCalledWith('org1', { refresh: false });
    }
  });
});
