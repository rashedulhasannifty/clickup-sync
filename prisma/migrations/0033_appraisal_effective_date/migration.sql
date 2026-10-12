-- Appraisal timing and outcome effective date.
-- An approved FORM_100 outcome (CONFIRMED / PROMOTED / INCREMENT events, and the
-- confirmation date) takes effect from the due date, the approval (sign-off) date or a
-- chosen date. Null mode = the default, resolved at sign-off (DUE_DATE when the appraisal
-- is late, else APPROVAL_DATE). Additive: two nullable columns and one enum.
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md ("Slice 3").
--
-- Generated with `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma
-- --script`, then reviewed by hand. Hand edits: the two backfill UPDATEs below.

-- CreateEnum
CREATE TYPE "AppraisalEffectiveDate" AS ENUM ('DUE_DATE', 'APPROVAL_DATE', 'CUSTOM');

-- AlterTable
ALTER TABLE "appraisals" ADD COLUMN     "effective_date" DATE,
ADD COLUMN     "effective_date_mode" "AppraisalEffectiveDate";

-- Backfill: appraisals created before 0033 keep today's behaviour, the approval date.
UPDATE "appraisals" SET "effective_date_mode" = 'APPROVAL_DATE';

-- Signed-off rows record the resolved date: the Dhaka calendar date of the sign-off.
-- signed_off_at is TIMESTAMP(3) without a time zone holding UTC.
UPDATE "appraisals"
SET "effective_date" = (("signed_off_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dhaka')::date
WHERE "signed_off_at" IS NOT NULL;
