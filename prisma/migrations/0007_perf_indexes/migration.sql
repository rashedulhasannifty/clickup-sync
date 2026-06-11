-- Performance indexes for the hot dashboard queries.
--
-- These are PARTIAL / COMPOSITE indexes that Prisma's `@@index` cannot express
-- (no WHERE-clause support), so they live only in raw migration SQL, following
-- the existing hand-authored `idx_<table>_<col>` naming convention used in
-- 0001_initial. `CREATE INDEX IF NOT EXISTS` keeps the migration idempotent.

-- Default Tasks list / reports filter `is_deleted = false AND archived = false`
-- and sort by `updated_date DESC` (reports.service.ts list path). A partial
-- index keyed on the sort column and scoped to the visible rows serves it
-- without indexing soft-deleted/archived rows.
CREATE INDEX IF NOT EXISTS idx_clickup_tasks_active_updated_date
  ON clickup_tasks (updated_date DESC)
  WHERE is_deleted = false AND archived = false;

-- stats().missingRateEntries counts the whole table WHERE status <> 'COST_CALCULATED'
-- on every Overview load. A partial index makes that an index-only scan of the
-- (small) not-yet-costed outlier set instead of a full sequential scan.
CREATE INDEX IF NOT EXISTS idx_clickup_time_entries_uncosted
  ON clickup_time_entries (status)
  WHERE status <> 'COST_CALCULATED';

-- Time-entry aggregates filter a `start_time` range and frequently also `status`.
-- A composite covers those better than the existing lone (start_time) index.
CREATE INDEX IF NOT EXISTS idx_clickup_time_entries_start_time_status
  ON clickup_time_entries (start_time, status);
