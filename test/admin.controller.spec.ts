import { AdminController } from '../src/admin/admin.controller';

describe('AdminController', () => {
  function makeClickup() {
    return { getTeamMembers: jest.fn().mockResolvedValue([]) } as any;
  }

  function makeAuditLog() {
    return { findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }) } as any;
  }

  function ctrlWithSettings(settings: any) {
    return new AdminController(
      makeClickup(),
      makeAuditLog(),
      settings,
      { search: jest.fn() } as any,
      { forTask: jest.fn() } as any,
    );
  }

  describe('settings', () => {
    it('getSettings returns masked settings from the service', () => {
      const masked = { teamId: '1', apiTokenSet: true, encryptionEnabled: true };
      const settings = { getMasked: jest.fn().mockReturnValue(masked) } as any;
      expect(ctrlWithSettings(settings).getSettings()).toBe(masked);
    });

    it('updateSettings rejects secret writes when encryption is disabled', () => {
      const settings = { getMasked: jest.fn().mockReturnValue({ encryptionEnabled: false }), update: jest.fn() } as any;
      expect(() => ctrlWithSettings(settings).updateSettings({ apiToken: 'pk_x' }, { email: 'me@test.com', isMachine: false } as any)).toThrow(/APP_ENCRYPTION_KEY/);
      expect(settings.update).not.toHaveBeenCalled();
    });

    it('updateSettings delegates non-secret fields with the session actor (not a spoofable header)', async () => {
      const settings = {
        getMasked: jest.fn().mockReturnValue({ encryptionEnabled: true }),
        update: jest.fn().mockResolvedValue({ teamId: '9' }),
      } as any;
      await ctrlWithSettings(settings).updateSettings({ teamId: '9' }, { email: 'me@test.com', isMachine: false } as any);
      expect(settings.update).toHaveBeenCalledWith({ teamId: '9' }, 'me@test.com');
    });
  });
});
