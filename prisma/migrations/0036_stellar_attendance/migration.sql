-- People: Stellar HRM attendance import, work shifts, and a typed attendance source.
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md ("Stellar HRM").

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('DUMMY', 'STELLAR_CSV', 'STELLAR_API');

-- AlterTable: the Stellar User ID and the working shift.
ALTER TABLE "employees" ADD COLUMN     "attendance_id" TEXT,
ADD COLUMN     "shift_id" TEXT;

-- AlterTable: session detail from the door system.
ALTER TABLE "attendance_days" ADD COLUMN     "missing_out" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "sessions" INTEGER,
ADD COLUMN     "worked_minutes" INTEGER;

-- AlterTable: `source` TEXT -> enum IN PLACE. Prisma generates DROP COLUMN + ADD COLUMN NOT NULL,
-- which fails on existing rows and would lose them. Only the dummy provider has ever written
-- attendance, so every existing row is DUMMY.
ALTER TABLE "attendance_days" ALTER COLUMN "source" TYPE "AttendanceSource" USING 'DUMMY'::"AttendanceSource";

-- CreateTable
CREATE TABLE "work_shifts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "track_punctuality" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_shifts_org_id_name_key" ON "work_shifts"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_attendance_id_key" ON "employees"("attendance_id");

-- CreateIndex
CREATE INDEX "employees_shift_id_idx" ON "employees"("shift_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
