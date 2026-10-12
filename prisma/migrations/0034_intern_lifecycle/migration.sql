-- The intern lifecycle: Intern -> Probation (6 months) -> Confirmation -> a yearly appraisal
-- every year, counted from the PROBATION START date (no longer the join date).
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md ("Intern lifecycle (0034)").
--
-- Generated with `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma
-- --script`, then reviewed by hand. Hand edits: the comments and the backfill UPDATE below.
--
-- Additive: one new enum, new enum values and five nullable columns. PostgreSQL cannot use an
-- enum value in the transaction that adds it, so nothing below uses INTERN, PROBATION_STARTED,
-- INTERNSHIP_EXTENDED or INTERNSHIP.

-- CreateEnum: an internship review's single recommendation.
CREATE TYPE "InternshipOutcome" AS ENUM ('MOVE_TO_PROBATION', 'EXTEND_INTERNSHIP', 'END_INTERNSHIP');

-- AlterEnum
ALTER TYPE "EmployeeStatus" ADD VALUE 'INTERN';

-- AlterEnum
ALTER TYPE "EmploymentEventType" ADD VALUE 'PROBATION_STARTED';
ALTER TYPE "EmploymentEventType" ADD VALUE 'INTERNSHIP_EXTENDED';

-- AlterEnum
ALTER TYPE "AppraisalType" ADD VALUE 'INTERNSHIP';

-- AlterTable: the schedule anchor and the expected internship end.
ALTER TABLE "employees" ADD COLUMN     "internship_end_date" DATE,
ADD COLUMN     "probation_start_date" DATE;

-- Backfill: everyone before 0034 started probation on joining, so their schedule is unchanged.
UPDATE "employees" SET "probation_start_date" = "join_date";

-- AlterTable: an internship review's recommendation and its date.
ALTER TABLE "appraisals" ADD COLUMN     "internship_outcome" "InternshipOutcome",
ADD COLUMN     "proposed_internship_end" DATE,
ADD COLUMN     "proposed_probation_start" DATE;
