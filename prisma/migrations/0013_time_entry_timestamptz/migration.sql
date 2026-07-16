-- Align `clickup_time_entries.start_time` / `end_time` to TIMESTAMPTZ.
--
-- Background: migration 0001 created these columns as TIMESTAMPTZ, but the
-- Prisma schema declared them as bare `DateTime` (no `@db.Timestamptz`), so a
-- later `prisma db push`/`migrate dev` on some environments silently altered
-- them to `timestamp without time zone` (naive). Reporting SQL then buckets
-- `start_time` into Dhaka calendar days, and the correct conversion differs by
-- column type — the drift produced a per-day timesheet mismatch vs ClickUp.
--
-- This migration converges every environment onto TIMESTAMPTZ and matches the
-- (now corrected) Prisma schema. It is GUARDED: it only rewrites a column that
-- is currently naive. On environments already TIMESTAMPTZ (e.g. production,
-- deployed from 0001) it is a no-op — an unconditional `ALTER ... USING
-- start_time AT TIME ZONE 'UTC'` on an already-timestamptz column would
-- double-convert and corrupt the stored instants.
--
-- The `USING ... AT TIME ZONE 'UTC'` clause interprets the naive value as the
-- UTC wall-clock it was stored as (Prisma writes `new Date(ms)` as UTC), so the
-- absolute instant is preserved across the type change.

DO $$
BEGIN
  IF (SELECT data_type
        FROM information_schema.columns
       WHERE table_name = 'clickup_time_entries'
         AND column_name = 'start_time') = 'timestamp without time zone' THEN
    ALTER TABLE "clickup_time_entries"
      ALTER COLUMN "start_time" TYPE TIMESTAMPTZ USING "start_time" AT TIME ZONE 'UTC';
  END IF;

  IF (SELECT data_type
        FROM information_schema.columns
       WHERE table_name = 'clickup_time_entries'
         AND column_name = 'end_time') = 'timestamp without time zone' THEN
    ALTER TABLE "clickup_time_entries"
      ALTER COLUMN "end_time" TYPE TIMESTAMPTZ USING "end_time" AT TIME ZONE 'UTC';
  END IF;
END $$;
