-- People slice 2: employee documents (the files live in a private MinIO bucket; this table is the index).
-- Spec: docs/superpowers/specs/2026-10-07-people-attendance-design.md ("Slice 2")

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('IDENTITY', 'EMPLOYMENT', 'EDUCATION', 'APPRAISAL', 'EXIT', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('HR_ONLY', 'HR_AND_EMPLOYEE', 'EVERYONE');

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "doc_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "replaced_by_id" TEXT,
    "expires_on" DATE,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'HR_ONLY',
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_storage_key_key" ON "employee_documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_replaced_by_id_key" ON "employee_documents"("replaced_by_id");

-- CreateIndex
CREATE INDEX "employee_documents_employee_id_deleted_at_idx" ON "employee_documents"("employee_id", "deleted_at");

-- CreateIndex
CREATE INDEX "employee_documents_expires_on_idx" ON "employee_documents"("expires_on");

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
