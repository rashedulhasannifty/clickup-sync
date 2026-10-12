import { LATE_AFTER_MINUTES, WORKING_DAY_HOURS } from './people.constants';
import { dhakaMinutesOfDay } from './people-dates';

/**
 * Pure shift maths: what "late" and "a working day" mean for one employee.
 * No shift = the office default (late after 09:30, 8-hour day), so everyone
 * without a shift keeps exactly the pre-shift behaviour.
 */

export interface ShiftLike {
  /** Minutes after Dhaka midnight, 0-1439. */
  startMinutes: number;
  endMinutes: number;
  graceMinutes: number;
  trackPunctuality: boolean;
}

export interface Punctuality {
  /** False: punctuality does not apply (irregular hours): no late badges, no punctuality KPI. */
  tracked: boolean;
  /** On time = first-in at or before this many minutes after Dhaka midnight. */
  lateAfterMinutes: number;
  /** Expected hours per working day (the utilisation denominator). */
  dayHours: number;
}

export const DEFAULT_PUNCTUALITY: Punctuality = {
  tracked: true,
  lateAfterMinutes: LATE_AFTER_MINUTES,
  dayHours: WORKING_DAY_HOURS,
};

/** Shift length in minutes; an end before the start crosses midnight. Equal start and end = 24 h. */
export function shiftLengthMinutes(start: number, end: number): number {
  return (end - start + 1440) % 1440 || 1440;
}

export function punctualityOf(shift: ShiftLike | null | undefined): Punctuality {
  if (!shift) return DEFAULT_PUNCTUALITY;
  return {
    tracked: shift.trackPunctuality,
    lateAfterMinutes: shift.startMinutes + shift.graceMinutes,
    dayHours:
      Math.round(
        (shiftLengthMinutes(shift.startMinutes, shift.endMinutes) / 60) * 100,
      ) / 100,
  };
}

/** On time = first entry at or before start + grace (fractional minutes: one second over is late). */
export function isOnTimeFor(firstIn: Date, p: Punctuality): boolean {
  return dhakaMinutesOfDay(firstIn) <= p.lateAfterMinutes;
}

/** Minutes of day -> `HH:MM`. */
export function formatMinutes(m: number): string {
  const n = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
