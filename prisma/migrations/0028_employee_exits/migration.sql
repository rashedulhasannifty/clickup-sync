-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('RESIGNATION', 'TERMINATION', 'CONTRACT_END', 'OTHER');

-- CreateEnum
CREATE TYPE "ExitStatus" AS ENUM ('NOTICE', 'INTERVIEW', 'CLEARANCE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExitInterviewReason" AS ENUM ('CAREER_GROWTH', 'COMPENSATION', 'MANAGEMENT', 'WORK_LIFE_BALANCE', 'RELOCATION', 'STUDIES', 'OTHER');

-- CreateEnum
CREATE TYPE "ExitAnswer" AS ENUM ('YES', 'MAYBE', 'NO');

-- CreateTable
CREATE TABLE "employee_exits" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "ExitType" NOT NULL,
    "status" "ExitStatus" NOT NULL DEFAULT 'NOTICE',
    "notice_date" DATE NOT NULL,
    "last_working_day" DATE NOT NULL,
    "reason" TEXT,
    "previous_status" "EmployeeStatus" NOT NULL,
    "interview_reason" "ExitInterviewReason",
    "rating_role" INTEGER,
    "rating_lead" INTEGER,
    "rating_compensation" INTEGER,
    "rating_growth" INTEGER,
    "rating_environment" INTEGER,
    "interview_feedback" TEXT,
    "would_recommend" "ExitAnswer",
    "would_rejoin" "ExitAnswer",
    "interview_notes" TEXT,
    "interview_by" TEXT,
    "interview_at" TIMESTAMP(3),
    "override_note" TEXT,
    "login_disabled" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_exits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_clearance_items" (
    "id" TEXT NOT NULL,
    "exit_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_by" TEXT,
    "done_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "exit_clearance_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_exits_employee_id_status_idx" ON "employee_exits"("employee_id", "status");

-- CreateIndex
CREATE INDEX "employee_exits_status_created_at_idx" ON "employee_exits"("status", "created_at");

-- CreateIndex
CREATE INDEX "exit_clearance_items_exit_id_position_idx" ON "exit_clearance_items"("exit_id", "position");

-- AddForeignKey
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_clearance_items" ADD CONSTRAINT "exit_clearance_items_exit_id_fkey" FOREIGN KEY ("exit_id") REFERENCES "employee_exits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One ACTIVE exit per employee. Prisma cannot express a partial unique index, so it lives here only.
CREATE UNIQUE INDEX "employee_exits_one_active_per_employee" ON "employee_exits"("employee_id") WHERE "status" IN ('NOTICE', 'INTERVIEW', 'CLEARANCE');
