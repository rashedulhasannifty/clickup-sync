-- Our own Chargeable/Non-chargeable flag, replacing reporting's use of
-- ClickUp's per-time-entry `billable` (which nobody maintains in ClickUp).
-- Every existing task becomes chargeable via the default; no backfill needed.
ALTER TABLE "clickup_tasks"
  ADD COLUMN IF NOT EXISTS "is_chargeable" BOOLEAN NOT NULL DEFAULT true;

-- Partial index: almost every row is `true`, so only the non-chargeable side
-- is selective enough to be worth indexing.
CREATE INDEX IF NOT EXISTS "clickup_tasks_non_chargeable_idx"
  ON "clickup_tasks" ("task_id")
  WHERE "is_chargeable" = false;
