import { AdminTagsController } from '../src/admin/admin-tags.controller';

describe('AdminTagsController', () => {
  function makeTagAssigneeRepo() {
    return {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  describe('tag-assignee map CRUD', () => {
    it('listTagAssignee delegates to tagAssigneeRepo.findAll', async () => {
      const tagAssigneeRepo = makeTagAssigneeRepo();
      await new AdminTagsController(tagAssigneeRepo).listTagAssignee();
      expect(tagAssigneeRepo.findAll).toHaveBeenCalled();
    });

    it('deleteTagAssignee calls tagAssigneeRepo.remove with parsed BigInt id', async () => {
      const tagAssigneeRepo = makeTagAssigneeRepo();
      await new AdminTagsController(tagAssigneeRepo).deleteTagAssignee('7');
      expect(tagAssigneeRepo.remove).toHaveBeenCalledWith(BigInt(7));
    });
  });
});
