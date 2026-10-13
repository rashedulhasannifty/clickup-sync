import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BANGLADESH_HOLIDAYS } from './holiday-presets';
import { groupHolidays, type HolidayGroup } from './holiday-groups';
import { HolidaysRepository } from './holidays.repository';
import { addDays, diffDays, formatDay } from './people-dates';

/** Longest single holiday the API accepts (a long Eid break is about ten days). */
const MAX_HOLIDAY_DAYS = 31;

export interface HolidayYear {
  year: number;
  holidays: HolidayGroup[];
  /** Preset Bangladesh dates for this year that are not in the list yet; null when there is no preset for the year. */
  presetMissing: number | null;
}

@Injectable()
export class HolidaysService {
  constructor(private readonly repo: HolidaysRepository) {}

  async year(orgId: string, year: number): Promise<HolidayYear> {
    const rows = await this.repo.list(orgId, `${year}-01-01`, `${year}-12-31`);
    const preset = BANGLADESH_HOLIDAYS[year];
    const have = new Set(rows.map((r) => r.date));
    return {
      year,
      holidays: groupHolidays(rows),
      presetMissing: preset
        ? presetDates(year).filter((d) => !have.has(d.date)).length
        : null,
    };
  }

  /** Adds one holiday over [from, to]. Refuses a range that overlaps an existing holiday. */
  async create(
    orgId: string,
    input: { name: string; from: string; to: string; tentative?: boolean },
    createdBy: string | null,
  ): Promise<{ added: number }> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Give the holiday a name');
    const span = diffDays(input.from, input.to) + 1;
    if (span < 1)
      throw new BadRequestException('The end date is before the start date');
    if (span > MAX_HOLIDAY_DAYS)
      throw new BadRequestException(
        `A holiday can be at most ${MAX_HOLIDAY_DAYS} days`,
      );
    const clash = await this.repo.list(orgId, input.from, input.to);
    if (clash.length > 0) {
      const c = clash[0];
      throw new ConflictException(
        `${formatDay(c.date)} is already a holiday (${c.name}). Edit or delete that one first.`,
      );
    }
    const rows = [];
    for (let i = 0; i < span; i++)
      rows.push({
        date: addDays(input.from, i),
        name,
        tentative: input.tentative ?? false,
      });
    return { added: await this.repo.createMany(orgId, rows, createdBy) };
  }

  /** Renames or (un)marks a whole holiday; `ids` are the dates of one group. */
  async update(
    orgId: string,
    ids: string[],
    data: { name?: string; tentative?: boolean },
  ): Promise<{ updated: number }> {
    await this.requireAll(orgId, ids);
    const name = data.name?.trim();
    if (data.name !== undefined && !name)
      throw new BadRequestException('Give the holiday a name');
    return {
      updated: await this.repo.update(orgId, ids, {
        ...(name !== undefined ? { name } : {}),
        ...(data.tentative !== undefined ? { tentative: data.tentative } : {}),
      }),
    };
  }

  async remove(orgId: string, ids: string[]): Promise<{ deleted: number }> {
    await this.requireAll(orgId, ids);
    return { deleted: await this.repo.delete(orgId, ids) };
  }

  /** Adds the Bangladesh government holidays for `year`; dates already in the list are left as they are. */
  async prefill(
    orgId: string,
    year: number,
    createdBy: string | null,
  ): Promise<{ added: number; skipped: number }> {
    if (!BANGLADESH_HOLIDAYS[year])
      throw new BadRequestException(
        `There is no Bangladesh holiday list for ${year}; add the dates by hand.`,
      );
    const rows = presetDates(year);
    const added = await this.repo.createMany(orgId, rows, createdBy);
    return { added, skipped: rows.length - added };
  }

  private async requireAll(orgId: string, ids: string[]): Promise<void> {
    const found = await this.repo.findMany(orgId, ids);
    if (found.length !== new Set(ids).size)
      throw new NotFoundException('Holiday not found');
  }
}

/** Every date of the preset list for `year`, one row per day. */
export function presetDates(
  year: number,
): { date: string; name: string; tentative: boolean }[] {
  const out: { date: string; name: string; tentative: boolean }[] = [];
  for (const p of BANGLADESH_HOLIDAYS[year] ?? [])
    for (let d = p.from; d <= p.to; d = addDays(d, 1))
      out.push({ date: d, name: p.name, tentative: p.tentative });
  return out;
}
