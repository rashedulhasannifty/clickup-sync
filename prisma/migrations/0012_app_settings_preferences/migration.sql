-- Non-secret UI preferences (notification alerts/channels, reconcile lookback,
-- per-space scheduled-sync enable map). Nullable: existing rows read as defaults.
ALTER TABLE "app_settings"
  ADD COLUMN "preferences" JSONB;
