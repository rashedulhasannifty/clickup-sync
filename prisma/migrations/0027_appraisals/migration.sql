-- People slice 3: appraisal cycles and appraisals.
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md ("Slice 3")

-- CreateEnum
CREATE TYPE "AppraisalCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AppraisalStatus" AS ENUM ('SELF_REVIEW', 'LEAD_REVIEW', 'CALIBRATION', 'SIGNED_OFF');

-- CreateEnum
CREATE TYPE "AppraisalRecommendation" AS ENUM ('PROMOTE', 'RAISE', 'NO_CHANGE', 'IMPROVEMENT_PLAN');

-- CreateTable
CREATE TABLE "appraisal_cycles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "AppraisalCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "kpi_weight" INTEGER NOT NULL DEFAULT 70,
    "competencies" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appraisal_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisals" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "status" "AppraisalStatus" NOT NULL DEFAULT 'SELF_REVIEW',
    "self_ratings" JSONB NOT NULL DEFAULT '{}',
    "self_comment" TEXT,
    "lead_ratings" JSONB NOT NULL DEFAULT '{}',
    "lead_comment" TEXT,
    "strengths" TEXT,
    "improvements" TEXT,
    "goals" TEXT,
    "recommendation" "AppraisalRecommendation",
    "new_designation" TEXT,
    "calibration_note" TEXT,
    "calibrated_score" DOUBLE PRECISION,
    "kpi_snapshot" JSONB,
    "kpi_snapshot_at" TIMESTAMP(3),
    "final_score" DOUBLE PRECISION,
    "final_partial" BOOLEAN,
    "signed_off_at" TIMESTAMP(3),
    "signed_off_by" TEXT,
    "outcome_applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appraisal_cycles_org_id_status_idx" ON "appraisal_cycles"("org_id", "status");

-- CreateIndex
CREATE INDEX "appraisals_employee_id_idx" ON "appraisals"("employee_id");

-- CreateIndex
CREATE INDEX "appraisals_reviewer_id_idx" ON "appraisals"("reviewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "appraisals_cycle_id_employee_id_key" ON "appraisals"("cycle_id", "employee_id");

-- AddForeignKey
ALTER TABLE "appraisal_cycles" ADD CONSTRAINT "appraisal_cycles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "appraisal_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
