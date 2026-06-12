-- Add configurable absolute daily-hours spike cap (default 12).
ALTER TABLE "app_settings"
  ADD COLUMN "spike_hours_cap" INTEGER NOT NULL DEFAULT 12;
