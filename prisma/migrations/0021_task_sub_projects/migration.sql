-- ClickUp "Sub-Project" labels custom field. A task can carry several, so it's
-- an array, not a comma-joined string: the dashboard filter matches with
-- `&&` (Prisma `hasSome`), which is exact per value — "App" never matches
-- "App v2" the way a substring match would.
-- No NOT NULL: Prisma never emits it for scalar lists, so adding it here would
-- show up as drift on the next `migrate dev`. Existing rows get the default.
ALTER TABLE "clickup_tasks"
  ADD COLUMN IF NOT EXISTS "sub_projects" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- GIN so the `&&` filter doesn't scan the table.
CREATE INDEX IF NOT EXISTS "clickup_tasks_sub_projects_idx"
  ON "clickup_tasks" USING GIN ("sub_projects");
