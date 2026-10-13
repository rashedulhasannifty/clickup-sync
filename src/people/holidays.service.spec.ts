import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BANGLADESH_HOLIDAYS } from './holiday-presets';
import { HolidaysService, presetDates } from './holidays.service';

function make(existing: { id: string; date: string; name: string; tentative: boolean }[] = []) {
  const repo = {
    list: jest.fn().mockResolvedValue(existing),
    findMany: jest.fn((_org: string, ids: string[]) =>
      Promise.resolve(existing.filter((r) => ids.includes(r.id))),
    ),
    createMany: jest.fn((_org: string, rows: unknown[], _by: string | null) =>
      Promise.resolve(rows.length),
    ),
    update: jest.fn().mockResolvedValue(1),
    delete: jest.fn().mockResolvedValue(1),
  };
  return { svc: new HolidaysService(repo as never), repo };
}

describe('HolidaysService', () => {
  it('adds one row per day of the range, trimmed', async () => {
    const { svc, repo } = make();
    await expect(
      svc.create('org', { name: ' Eid-ul-Fitr ', from: '2026-03-18', to: '2026-03-23' }, 'u1'),
    ).resolves.toEqual({ added: 6 });
    const rows = repo.createMany.mock.calls[0][1] as { date: string; name: string }[];
    expect(rows.map((r) => r.date)).toEqual([
      '2026-03-18',
      '2026-03-19',
      '2026-03-20',
      '2026-03-21',
      '2026-03-22',
      '2026-03-23',
    ]);
    expect(rows[0].name).toBe('Eid-ul-Fitr');
    expect(repo.createMany.mock.calls[0][2]).toBe('u1');
  });

  it('refuses a backwards or over-long range, a blank name, and an overlap', async () => {
    const { svc } = make();
    await expect(
      svc.create('org', { name: 'x', from: '2026-03-23', to: '2026-03-18' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create('org', { name: 'x', from: '2026-01-01', to: '2026-03-01' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create('org', { name: '  ', from: '2026-03-18', to: '2026-03-18' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    const clash = make([{ id: 'h1', date: '2026-03-26', name: 'Independence Day', tentative: false }]);
    await expect(
      clash.svc.create('org', { name: 'x', from: '2026-03-25', to: '2026-03-27' }, null),
    ).rejects.toThrow(new ConflictException('26 Mar 2026 is already a holiday (Independence Day). Edit or delete that one first.'));
  });

  it('edits and deletes only ids of the org', async () => {
    const { svc, repo } = make([{ id: 'h1', date: '2026-03-26', name: 'x', tentative: true }]);
    await expect(svc.update('org', ['h1'], { tentative: false })).resolves.toEqual({ updated: 1 });
    expect(repo.update).toHaveBeenCalledWith('org', ['h1'], { tentative: false });
    await expect(svc.remove('org', ['h1', 'other'])).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('prefills the preset year and reports how many preset dates are missing', async () => {
    const { svc, repo } = make([{ id: 'h1', date: '2026-12-16', name: 'Victory Day', tentative: false }]);
    repo.createMany.mockResolvedValueOnce(presetDates(2026).length - 1);
    await expect(svc.prefill('org', 2026, 'u1')).resolves.toEqual({
      added: presetDates(2026).length - 1,
      skipped: 1,
    });
    const y = await svc.year('org', 2026);
    expect(y.presetMissing).toBe(presetDates(2026).length - 1);
    expect((await svc.year('org', 2030)).presetMissing).toBeNull();
    await expect(svc.prefill('org', 2030, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preset ranges are well-formed and inside their year', () => {
    for (const [year, list] of Object.entries(BANGLADESH_HOLIDAYS))
      for (const p of list) {
        expect(p.from <= p.to).toBe(true);
        expect(p.from.startsWith(year) && p.to.startsWith(year)).toBe(true);
      }
    const dates = presetDates(2026).map((d) => d.date);
    expect(new Set(dates).size).toBe(dates.length);
  });
});
