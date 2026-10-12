/**
 * Pure "suggest shifts from attendance": each employee's median first-in over
 * real (imported) business days, matched to the nearest existing shift start.
 * Proposals only; nothing here or in its caller applies them.
 */

export interface SuggestShift {
  id: string;
  name: string;
  startMinutes: number;
  trackPunctuality: boolean;
}

export interface SuggestEmployee {
  id: string;
  fullName: string;
  shiftId: string | null;
  /** First-in minutes after Dhaka midnight, one per real business day. */
  firstIns: number[];
}

export interface ShiftSuggestion {
  employeeId: string;
  fullName: string;
  currentShiftId: string | null;
  /** Median first-in, minutes after Dhaka midnight (rounded). */
  medianFirstIn: number;
  sampleDays: number;
  /** Interquartile range of first-ins, minutes: how regular the arrivals are. */
  spreadMinutes: number;
  /** Arrivals spread wider than `IRREGULAR_SPREAD_MINUTES`. */
  irregular: boolean;
  proposedShiftId: string;
  proposedShiftName: string;
  /** Minutes between the median and the proposed shift's start (around the clock). */
  distanceMinutes: number;
  /** The proposal differs from the current shift. */
  changes: boolean;
}

export const MIN_SAMPLE_DAYS = 5;
export const IRREGULAR_SPREAD_MINUTES = 180;

/** Distance between two times of day, the short way round the clock. */
export function clockDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * One suggestion per employee with at least `minDays` real arrivals, when
 * any shift exists. The nearest start wins (ties: the earlier start, then the
 * name). Irregular arrivals prefer a shift that does not track punctuality,
 * when there is one: a fixed start would only mark them late.
 */
export function suggestShifts(
  employees: SuggestEmployee[],
  shifts: SuggestShift[],
  minDays = MIN_SAMPLE_DAYS,
): ShiftSuggestion[] {
  if (shifts.length === 0) return [];
  const out: ShiftSuggestion[] = [];
  for (const e of employees) {
    if (e.firstIns.length < minDays) continue;
    const sorted = [...e.firstIns].sort((a, b) => a - b);
    const med = quantile(sorted, 0.5);
    const spread = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    const irregular = spread > IRREGULAR_SPREAD_MINUTES;
    const untracked = shifts.filter((s) => !s.trackPunctuality);
    const tracked = shifts.filter((s) => s.trackPunctuality);
    // A regular arriver belongs on a tracked shift: an untracked one only "wins" by its start
    // time being nearest, which would silently switch punctuality off for a punctual person.
    const pool =
      irregular && untracked.length > 0
        ? untracked
        : tracked.length > 0
          ? tracked
          : shifts;
    const best = [...pool].sort(
      (a, b) =>
        clockDistance(med, a.startMinutes) - clockDistance(med, b.startMinutes) ||
        a.startMinutes - b.startMinutes ||
        a.name.localeCompare(b.name),
    )[0];
    out.push({
      employeeId: e.id,
      fullName: e.fullName,
      currentShiftId: e.shiftId,
      medianFirstIn: Math.round(med),
      sampleDays: sorted.length,
      spreadMinutes: Math.round(spread),
      irregular,
      proposedShiftId: best.id,
      proposedShiftName: best.name,
      distanceMinutes: Math.round(clockDistance(med, best.startMinutes)),
      changes: best.id !== e.shiftId,
    });
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
