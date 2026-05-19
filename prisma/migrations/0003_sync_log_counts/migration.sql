ALTER TABLE "sync_job_logs"
  ADD COLUMN IF NOT EXISTS "tasks_synced"        INTEGER,
  ADD COLUMN IF NOT EXISTS "time_entries_synced" INTEGER;
