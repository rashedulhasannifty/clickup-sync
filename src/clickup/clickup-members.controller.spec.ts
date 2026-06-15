import { ClickupMembersController } from './clickup-members.controller';
import type { MemberDto } from './workspace-members.service';

describe('ClickupMembersController', () => {
  it('returns the workspace member directory', async () => {
    const directory: MemberDto[] = [
      { id: '1', name: 'Ada', email: 'ada@x.com', profilePicture: 'https://cdn/ada.png', color: '#7B68EE', initials: 'AD' },
    ];
    const members = { getDirectory: jest.fn().mockResolvedValue(directory) } as any;
    const controller = new ClickupMembersController(members);
    expect(await controller.list()).toBe(directory);
    expect(members.getDirectory).toHaveBeenCalledTimes(1);
  });
});
