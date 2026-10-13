import { addDays, isBusinessDay } from './people-dates';
import type { HolidayRow } from './holidays.repository';

/** Consecutive dates with the same name, shown and edited as one holiday (Eid over six days). */
export interface HolidayGroup {
  ids: string[];
  name: string;
  from: string;
  to: string;
  /** Calendar days in the group. */
  days: number;
  /** Mon-Fri days in the group: the ones that change attendance and scores. */
  workingDaysOff: number;
  /** Any date in the group still needs confirming. */
  tentative: boolean;
}

/** Groups rows (any order) into runs of consecutive dates sharing a name, oldest first. */
export function groupHolidays(rows: HolidayRow[]): HolidayGroup[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const out: HolidayGroup[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.name === r.name && addDays(last.to, 1) === r.date) {
      last.ids.push(r.id);
      last.to = r.date;
      last.days++;
      if (isBusinessDay(r.date)) last.workingDaysOff++;
      last.tentative ||= r.tentative;
      continue;
    }
    out.push({
      ids: [r.id],
      name: r.name,
      from: r.date,
      to: r.date,
      days: 1,
      workingDaysOff: isBusinessDay(r.date) ? 1 : 0,
      tentative: r.tentative,
    });
  }
  return out;
}
