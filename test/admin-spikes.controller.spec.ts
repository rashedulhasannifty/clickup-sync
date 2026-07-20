import { AdminSpikesController } from '../src/admin/admin-spikes.controller';

describe('AdminSpikesController', () => {
  function makeSpikeNotifications() {
    return {
      preview: jest.fn().mockResolvedValue({ date: '2026-06-10', recipientEmail: null, userName: null, totalHours: 0, tasks: [], alreadyNotified: false }),
      notify: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
  }

  function makeSpikeResolutions() {
    return {
      resolve: jest.fn().mockResolvedValue({ resolved: true, date: '2026-06-10' }),
      unresolve: jest.fn().mockResolvedValue({ resolved: false, date: '2026-06-10' }),
    } as any;
  }

  function makeCtrl(over: Partial<{ notifications: any; resolutions: any }> = {}) {
    return new AdminSpikesController(
      over.notifications ?? makeSpikeNotifications(),
      over.resolutions ?? makeSpikeResolutions(),
    );
  }

  describe('hour-spike resolutions', () => {
    it('resolveSpike delegates to the service with the actor', async () => {
      const resolutions = { resolve: jest.fn().mockResolvedValue({ resolved: true, date: '2026-06-10' }), unresolve: jest.fn() } as any;
      const ctrl = makeCtrl({ resolutions });
      const user = { id: 'admin@x', email: 'admin@x', role: 'OWNER' } as any;
      await ctrl.resolveSpike({ userId: 'u1', date: '2026-06-10', userName: 'Ann', note: 'ok' } as any, user);
      expect(resolutions.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', date: '2026-06-10', userName: 'Ann', note: 'ok', resolvedBy: 'admin@x' }),
      );
    });

    it('unresolveSpike delegates to the service', async () => {
      const resolutions = { resolve: jest.fn(), unresolve: jest.fn().mockResolvedValue({ resolved: false, date: '2026-06-10' }) } as any;
      const ctrl = makeCtrl({ resolutions });
      await ctrl.unresolveSpike({ userId: 'u1', date: '2026-06-10' } as any);
      expect(resolutions.unresolve).toHaveBeenCalledWith({ userId: 'u1', date: '2026-06-10' });
    });
  });
});
