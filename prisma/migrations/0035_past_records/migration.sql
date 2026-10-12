-- 0035: past records. History from before the system (joined as intern, probation,
-- confirmation, promotions, increments, transfers, paper appraisals), entered by HR.
--
-- Additive only. The one new enum value (JOINED_AS_INTERN) is not used anywhere in this
-- migration: Postgres cannot use a value in the transaction that adds it. `EventSource` is a
-- new type (CREATE TYPE), so its values can be used here.

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('APP', 'PAST_RECORD');

-- AlterEnum
ALTER TYPE "EmploymentEventType" ADD VALUE 'JOINED_AS_INTERN';

-- AlterTable: per field group, the values before the group's first past record (internal).
ALTER TABLE "employees" ADD COLUMN     "past_records_baseline" JSONB;

-- AlterTable: every existing event was written by the app.
ALTER TABLE "employment_events" ADD COLUMN     "source" "EventSource" NOT NULL DEFAULT 'APP';

-- One past record per employee, type and date: a double-submitted import cannot add a
-- record twice (the service already skips identical ones; this is the database's guarantee).
CREATE UNIQUE INDEX "employment_events_past_record_key" ON "employment_events"("employee_id", "type", "effective_date") WHERE "source" = 'PAST_RECORD';

-- CreateTable
CREATE TABLE "past_appraisals" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "AppraisalType" NOT NULL,
    "due_date" DATE,
    "conducted_on" DATE NOT NULL,
    "marks" DOUBLE PRECISION,
    "grade" TEXT,
    "outcome" TEXT,
    "actions" "AppraisalAction"[] DEFAULT ARRAY[]::"AppraisalAction"[],
    "document_id" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "past_appraisals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "past_appraisals_marks_check" CHECK ("marks" IS NULL OR ("marks" >= 0 AND "marks" <= 100)),
    CONSTRAINT "past_appraisals_grade_check" CHECK ("grade" IS NULL OR "grade" IN ('A', 'B', 'C', 'D', 'E', 'F'))
);

-- CreateIndex
CREATE INDEX "past_appraisals_employee_id_type_idx" ON "past_appraisals"("employee_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "past_appraisals_employee_id_type_conducted_on_key" ON "past_appraisals"("employee_id", "type", "conducted_on");

-- AddForeignKey
ALTER TABLE "past_appraisals" ADD CONSTRAINT "past_appraisals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "past_appraisals" ADD CONSTRAINT "past_appraisals_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
