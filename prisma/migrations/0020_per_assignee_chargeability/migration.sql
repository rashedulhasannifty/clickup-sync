-- Per-assignee chargeability: a (task, assignee) rule, plus a per-entry
-- override, layered over the existing task-level `is_chargeable` flag.
CREATE TABLE IF NOT EXISTS "task_assignee_chargeability" (
  "task_id"    TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "chargeable" BOOLEAN NOT NULL,
  "note"       TEXT,
  "set_by"     TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignee_chargeability_pkey" PRIMARY KEY ("task_id", "user_id")
);

-- A hard-deleted task takes its rules with it. Soft-deleted tasks keep theirs,
-- because the row survives.
ALTER TABLE "task_assignee_chargeability"
  ADD CONSTRAINT "task_assignee_chargeability_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "clickup_tasks"("task_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "task_assignee_chargeability_user_id_idx"
  ON "task_assignee_chargeability" ("user_id");

-- `chargeable_override` is nullable on purpose: NULL means "no override", which
-- is not the same as "overridden to chargeable".
ALTER TABLE "clickup_time_entries"
  ADD COLUMN IF NOT EXISTS "chargeable_override" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "is_chargeable" BOOLEAN NOT NULL DEFAULT true;

-- Backfill the resolved column to exactly today's semantics: an entry answers
-- to its task's flag, and a task-less entry is chargeable. Nothing about any
-- stored cost changes, so no recalculation is needed.
UPDATE "clickup_time_entries" e
   SET "is_chargeable" = false
  FROM "clickup_tasks" t
 WHERE e."task_id" = t."task_id"
   AND t."is_chargeable" = false;

-- Partial index, mirroring `clickup_tasks_non_chargeable_idx` from migration
-- 0019: almost every row is `true`, so only the non-chargeable side is
-- selective enough to be worth indexing.
CREATE INDEX IF NOT EXISTS "clickup_time_entries_non_chargeable_idx"
  ON "clickup_time_entries" ("time_entry_id")
  WHERE "is_chargeable" = false;
