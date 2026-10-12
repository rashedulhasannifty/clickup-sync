-- People: an editable career timeline. Events an approved appraisal writes are marked so they
-- stay locked. No backfill: no appraisal has been approved before this migration.

-- AlterTable
ALTER TABLE "employment_events" ADD COLUMN     "appraisal_id" TEXT;
