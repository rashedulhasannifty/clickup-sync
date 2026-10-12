-- People slice 3, reworked: appraisals follow the paper form
-- "Performance Appraisal Form – Asst. Managers and above" (10 criteria x 10 marks,
-- A-F grade, supervisor -> department head -> HR -> CTO/COO approval).
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md ("Slice 3").
--
-- Generated with `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma
-- --script`, then reviewed by hand. Hand edits:
--   * appraisal_cycles.scoring_mode: existing cycles are backfilled KPI_BLEND (their frozen
--     0-5 scores keep their meaning); only the column DEFAULT for new rows is FORM_100.
--   * appraisal_cycles.type: existing cycles become YEARLY (the generated default).
-- The values added to existing enums (AppraisalStatus, EmploymentEventType) are not used
-- anywhere in this migration: Postgres refuses a value added by ALTER TYPE ... ADD VALUE in
-- the same transaction.

-- CreateEnum
CREATE TYPE "AppraisalType" AS ENUM ('HALF_YEARLY', 'CONFIRMATION', 'YEARLY');

-- CreateEnum
CREATE TYPE "AppraisalScoringMode" AS ENUM ('KPI_BLEND', 'FORM_100');

-- CreateEnum
CREATE TYPE "AppraisalAction" AS ENUM ('CONFIRM', 'INCREMENT', 'PROMOTION', 'TERMINATION', 'DISMISSAL', 'TRAINING_TRANSFER');

-- CreateEnum
CREATE TYPE "AppraisalDecision" AS ENUM ('APPROVED', 'NOT_APPROVED');

-- AlterEnum
ALTER TYPE "EmploymentEventType" ADD VALUE 'INCREMENT';

-- AlterEnum (PostgreSQL 12+ allows several ADD VALUEs in one migration)
ALTER TYPE "AppraisalStatus" ADD VALUE 'DEPT_HEAD_REVIEW';
ALTER TYPE "AppraisalStatus" ADD VALUE 'HR_REVIEW';
ALTER TYPE "AppraisalStatus" ADD VALUE 'FINAL_APPROVAL';

-- AlterTable: the form's header fields. All nullable; the salaries are whole taka.
ALTER TABLE "employees" ADD COLUMN     "academic_qualification" TEXT,
ADD COLUMN     "concern_name" TEXT,
ADD COLUMN     "experience_before_joining_months" INTEGER,
ADD COLUMN     "gross_salary" INTEGER,
ADD COLUMN     "starting_salary" INTEGER;

-- AlterTable: existing cycles keep the legacy KPI blend; new cycles default to the form.
ALTER TABLE "appraisal_cycles" ADD COLUMN     "scoring_mode" "AppraisalScoringMode" NOT NULL DEFAULT 'KPI_BLEND',
ADD COLUMN     "type" "AppraisalType" NOT NULL DEFAULT 'YEARLY';
ALTER TABLE "appraisal_cycles" ALTER COLUMN "scoring_mode" SET DEFAULT 'FORM_100';

-- AlterTable: FORM_100 fields. Existing rows get an empty actions list and nulls.
ALTER TABLE "appraisals" ADD COLUMN     "actions" "AppraisalAction"[] DEFAULT ARRAY[]::"AppraisalAction"[],
ADD COLUMN     "approval_at" TIMESTAMP(3),
ADD COLUMN     "approval_by" TEXT,
ADD COLUMN     "approval_comment" TEXT,
ADD COLUMN     "approval_decision" "AppraisalDecision",
ADD COLUMN     "dept_head_at" TIMESTAMP(3),
ADD COLUMN     "dept_head_by" TEXT,
ADD COLUMN     "dept_head_comment" TEXT,
ADD COLUMN     "final_grade" TEXT,
ADD COLUMN     "form_document_id" TEXT,
ADD COLUMN     "form_header" JSONB,
ADD COLUMN     "hr_at" TIMESTAMP(3),
ADD COLUMN     "hr_by" TEXT,
ADD COLUMN     "hr_comment" TEXT,
ADD COLUMN     "increment_percent" DOUBLE PRECISION,
ADD COLUMN     "lead_review_at" TIMESTAMP(3),
ADD COLUMN     "lead_review_by" TEXT,
ADD COLUMN     "training_plan" TEXT;
