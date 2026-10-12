-- People slice 3: appraisals are counted from each employee's join date (confirmation at
-- 6 months, half-yearly every 6 months from 12 months, yearly on each join anniversary).
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md ("Slice 3").
--
-- Generated with `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma
-- --script`, then reviewed by hand. Hand edit:
--   * appraisal_cycles.period_basis: existing cycles are backfilled CALENDAR (their period stays
--     everyone's review period); only the column DEFAULT for new rows is JOIN_DATE.
-- The appraisal columns are nullable and stay null for existing rows: null means "the cycle's
-- own period applies".

-- CreateEnum
CREATE TYPE "AppraisalPeriodBasis" AS ENUM ('CALENDAR', 'JOIN_DATE');

-- AlterTable: existing cycles keep the calendar period; new cycles default to join dates.
ALTER TABLE "appraisal_cycles" ADD COLUMN     "period_basis" "AppraisalPeriodBasis" NOT NULL DEFAULT 'CALENDAR';
ALTER TABLE "appraisal_cycles" ALTER COLUMN "period_basis" SET DEFAULT 'JOIN_DATE';

-- AlterTable: JOIN_DATE cycles store each appraisal's own review period and due date.
ALTER TABLE "appraisals" ADD COLUMN     "due_date" DATE,
ADD COLUMN     "period_end" DATE,
ADD COLUMN     "period_start" DATE;
