import { sliceReconcileWindow, RECONCILE_WINDOW_SLICE_DAYS } from './reconcile-window.util';

const DAY = 24 * 60 * 60 * 1000;

describe('sliceReconcileWindow', () => {
  it('covers the window contiguously with no gaps and no overlaps', () => {
    const start = 1_000_000;
    const end = start + 95 * DAY;
    const slices = sliceReconcileWindow(start, end);

    expect(slices[0].startDate).toBe(start);
    expect(slices[slices.length - 1].endDate).toBe(end);
    slices.slice(1).forEach((s, i) => expect(s.startDate).toBe(slices[i].endDate));
  });

  it('never extends past endMs — the prune is scoped to exactly what was fetched', () => {
    // 95 days over 7-day slices leaves a 4-day tail; a full-width tail slice
    // would prune rows ClickUp was never asked about.
    const start = 0;
    const end = 95 * DAY;
    const slices = sliceReconcileWindow(start, end);

    expect(slices).toHaveLength(14);
    expect(slices[13]).toEqual({ startDate: 91 * DAY, endDate: 95 * DAY });
    slices.forEach((s) => expect(s.endDate).toBeLessThanOrEqual(end));
  });

  it('keeps each slice under the prune-safety cap at measured prod volume', () => {
    // Peak observed workspace-wide: ~84 entries/day. A slice at or above
    // PRUNE_SAFETY_MAX_ENTRIES (1000) silently skips delete-reconciliation.
    const PEAK_ENTRIES_PER_DAY = 84;
    const PRUNE_SAFETY_MAX_ENTRIES = 1000;
    expect(RECONCILE_WINDOW_SLICE_DAYS * PEAK_ENTRIES_PER_DAY).toBeLessThan(PRUNE_SAFETY_MAX_ENTRIES);
  });

  it('emits one slice when the window is shorter than the slice width', () => {
    expect(sliceReconcileWindow(0, 3 * DAY)).toEqual([{ startDate: 0, endDate: 3 * DAY }]);
  });

  it('uses a slice width small enough that pruning is not skipped', () => {
    expect(RECONCILE_WINDOW_SLICE_DAYS).toBeLessThanOrEqual(7);
  });

  it('splits a 365-day lookback into a bounded number of jobs', () => {
    // Cost guard: this is what the daily cron enqueues per space. These are
    // cheap team-level calls at backfill priority, one space per day.
    const slices = sliceReconcileWindow(0, 365 * DAY);
    expect(slices).toHaveLength(Math.ceil(365 / RECONCILE_WINDOW_SLICE_DAYS));
    expect(slices.length).toBeLessThanOrEqual(60);
  });

  it('returns nothing for an empty or inverted window', () => {
    expect(sliceReconcileWindow(500, 500)).toEqual([]);
    expect(sliceReconcileWindow(1000, 500)).toEqual([]);
  });

  it('returns nothing for non-finite bounds rather than looping', () => {
    expect(sliceReconcileWindow(NaN, 1000)).toEqual([]);
    expect(sliceReconcileWindow(0, Infinity)).toEqual([]);
  });

  it('clamps a non-positive slice width to one day instead of looping forever', () => {
    const slices = sliceReconcileWindow(0, 3 * DAY, 0);
    expect(slices).toHaveLength(3);
  });

  it('honours a custom slice width', () => {
    expect(sliceReconcileWindow(0, 10 * DAY, 5)).toEqual([
      { startDate: 0, endDate: 5 * DAY },
      { startDate: 5 * DAY, endDate: 10 * DAY },
    ]);
  });
});
