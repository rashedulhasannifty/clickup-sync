import { TagAssigneeMapRepository } from '../src/time-entries/tag-assignee-map.repository';

describe('TagAssigneeMapRepository.findByTagName', () => {
  it('calls findUnique with tagName', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: BigInt(1), tagName: 'chisty', clickupUserId: '242630708' });
    const prisma = { tagAssigneeMap: { findUnique } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    const result = await repo.findByTagName('chisty');

    expect(findUnique).toHaveBeenCalledWith({ where: { tagName: 'chisty' } });
    expect(result?.tagName).toBe('chisty');
  });
});

describe('TagAssigneeMapRepository.findAllActive', () => {
  it('queries for active mappings ordered by tagName', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { tagAssigneeMap: { findMany } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.findAllActive();

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { tagName: 'asc' },
    });
  });
});

describe('TagAssigneeMapRepository.findAll', () => {
  it('queries all mappings ordered by tagName', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { tagAssigneeMap: { findMany } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.findAll();

    expect(findMany).toHaveBeenCalledWith({ orderBy: { tagName: 'asc' } });
  });
});

describe('TagAssigneeMapRepository.create', () => {
  it('creates a row with the given data', async () => {
    const create = jest.fn().mockResolvedValue({ id: BigInt(1) });
    const prisma = { tagAssigneeMap: { create } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.create({ tagName: 'fahim', clickupUserId: '49377103' });

    expect(create).toHaveBeenCalledWith({
      data: { tagName: 'fahim', clickupUserId: '49377103' },
    });
  });
});

describe('TagAssigneeMapRepository.update', () => {
  it('updates a row by id with the given data', async () => {
    const update = jest.fn().mockResolvedValue({ id: BigInt(2) });
    const prisma = { tagAssigneeMap: { update } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.update(BigInt(2), { active: false });

    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(2) },
      data: { active: false },
    });
  });
});

describe('TagAssigneeMapRepository.create with active', () => {
  it('forwards active when provided', async () => {
    const create = jest.fn().mockResolvedValue({ id: BigInt(1) });
    const prisma = { tagAssigneeMap: { create } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.create({ tagName: 'sayem', clickupUserId: '5', active: false });

    expect(create).toHaveBeenCalledWith({
      data: { tagName: 'sayem', clickupUserId: '5', active: false },
    });
  });
});

describe('TagAssigneeMapRepository.update with tagName', () => {
  it('forwards a tagName rename', async () => {
    const update = jest.fn().mockResolvedValue({ id: BigInt(3) });
    const prisma = { tagAssigneeMap: { update } } as any;
    const repo = new TagAssigneeMapRepository(prisma);

    await repo.update(BigInt(3), { tagName: 'renamed' });

    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(3) },
      data: { tagName: 'renamed' },
    });
  });
});
