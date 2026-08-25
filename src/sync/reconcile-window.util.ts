/**
 * Window slicing for `RECONCILE_TIME_ENTRIES_WINDOW` jobs.
 *
 * A windowed reconcile is one team-level ClickUp call per (space × slice), so
 * the slice width is the unit of work: too wide and a single response risks
 * tripping `PRUNE_SAFETY_MAX_ENTRIES` (which disables pruning for that slice —
 * the very thing the reconcile exists to do); too narrow and a year-long
 * lookback fans out into hundreds of jobs on a 1.9 GB host.
 *
 * Extracted so the manual `POST /admin/time-entries/reconcile-window` endpoint
 * and the scheduled deep reconcile slice identically — they used to duplicate
 * this loop, and a drift between them would mean the cron silently covered a
 * different range than the endpoint operators test with.
 */

/**
 * Days covered by a single `RECONCILE_TIME_ENTRIES_WINDOW` job.
 *
 * Sized against `PRUNE_SAFETY_MAX_ENTRIES` (1000, in `TimeEntriesService`): a
 * slice that returns >= that many entries is treated as a possibly-truncated
 * read and its delete-reconciliation is SKIPPED — silently disabling the only
 * mechanism that detects a deletion in ClickUp.
 *
 * Measured on production (2026-08-25, 12 months of history): the busiest space
 * ("Projects") logs 1,255-2,300 entries per 30 days, and workspace-wide peaks
 * at 2,525 — so the previous 30-day slice tripped the cap on every single run
 * for that space, and pruning never happened. Peak is ~84 entries/day
 * workspace-wide, so a 7-day slice tops out near 590: comfortably under 1000
 * with ~40% headroom for growth.
 *
 * If entry volume roughly doubles, shrink this again (or raise the cap) — the
 * failure mode is silent, so it will not announce itself.
 */
export const RECONCILE_WINDOW_SLICE_DAYS = 7;

export interface ReconcileSlice {
  startDate: number;
  endDate: number;
}

/**
 * Split `[startMs, endMs)` into contiguous slices of at most `sliceDays`.
 *
 * The final slice is clamped to `endMs`, so slices never extend past the
 * requested window — pruning is scoped to exactly the range ClickUp was asked
 * about, and an over-long tail slice could prune rows that were never fetched.
 *
 * Returns `[]` for an empty or inverted window so callers enqueue nothing
 * rather than a job whose prune covers a nonsensical range.
 */
export function sliceReconcileWindow(
  startMs: number,
  endMs: number,
  sliceDays: number = RECONCILE_WINDOW_SLICE_DAYS,
): ReconcileSlice[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  // A non-positive slice width would loop forever; one day is the smallest
  // sensible unit of work.
  const days = Math.max(1, Math.floor(sliceDays));
  const sliceMs = days * 24 * 60 * 60 * 1000;

  const slices: ReconcileSlice[] = [];
  for (let sliceStart = startMs; sliceStart < endMs; sliceStart += sliceMs) {
    slices.push({ startDate: sliceStart, endDate: Math.min(sliceStart + sliceMs, endMs) });
  }
  return slices;
}
