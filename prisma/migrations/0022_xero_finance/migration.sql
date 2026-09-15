-- CreateEnum
CREATE TYPE "XeroConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "xero_connections" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tenant_id" TEXT,
    "connection_id" TEXT,
    "tenant_name" TEXT,
    "short_code" TEXT,
    "base_currency" TEXT,
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "access_expires_at" TIMESTAMP(3),
    "refreshed_at" TIMESTAMP(3),
    "connected_by_user_id" TEXT,
    "connected_by_email" TEXT,
    "connected_at" TIMESTAMP(3),
    "status" "XeroConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xero_contacts" (
    "contact_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phones" JSONB,
    "addresses" JSONB,
    "tax_number" TEXT,
    "default_currency" TEXT,
    "is_customer" BOOLEAN NOT NULL DEFAULT false,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "updated_date_utc" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_contacts_pkey" PRIMARY KEY ("contact_id")
);

-- CreateTable
CREATE TABLE "xero_invoices" (
    "invoice_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT,
    "reference" TEXT,
    "contact_id" UUID,
    "contact_name" TEXT,
    "status" TEXT NOT NULL,
    "date" DATE,
    "due_date" DATE,
    "currency_code" TEXT NOT NULL,
    "currency_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "sub_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_credited" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_due_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_items" JSONB NOT NULL,
    "has_attachments" BOOLEAN NOT NULL DEFAULT false,
    "updated_date_utc" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_invoices_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateTable
CREATE TABLE "xero_credit_notes" (
    "credit_note_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT,
    "reference" TEXT,
    "contact_id" UUID,
    "contact_name" TEXT,
    "status" TEXT NOT NULL,
    "date" DATE,
    "currency_code" TEXT NOT NULL,
    "currency_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "sub_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remaining_credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_items" JSONB NOT NULL,
    "has_attachments" BOOLEAN NOT NULL DEFAULT false,
    "updated_date_utc" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_credit_notes_pkey" PRIMARY KEY ("credit_note_id")
);

-- CreateTable
CREATE TABLE "xero_bank_transactions" (
    "bank_transaction_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "contact_id" UUID,
    "contact_name" TEXT,
    "bank_account_code" TEXT,
    "bank_account_name" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "date" DATE,
    "currency_code" TEXT NOT NULL,
    "currency_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "sub_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_items" JSONB NOT NULL,
    "has_attachments" BOOLEAN NOT NULL DEFAULT false,
    "updated_date_utc" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_bank_transactions_pkey" PRIMARY KEY ("bank_transaction_id")
);

-- CreateTable
CREATE TABLE "xero_payments" (
    "payment_id" UUID NOT NULL,
    "payment_type" TEXT NOT NULL,
    "cash_direction" TEXT,
    "status" TEXT NOT NULL,
    "invoice_id" UUID,
    "invoice_number" TEXT,
    "credit_note_id" UUID,
    "credit_note_number" TEXT,
    "contact_id" UUID,
    "contact_name" TEXT,
    "date" DATE,
    "currency_code" TEXT,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "amount_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bank_account_code" TEXT,
    "bank_account_name" TEXT,
    "reference" TEXT,
    "updated_date_utc" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "xero_attachments" (
    "id" BIGSERIAL NOT NULL,
    "attachment_id" UUID NOT NULL,
    "parent_type" TEXT NOT NULL,
    "parent_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "content_length" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xero_sync_state" (
    "entity" TEXT NOT NULL,
    "watermark" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "records_upserted" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_sync_state_pkey" PRIMARY KEY ("entity")
);

-- CreateIndex
CREATE INDEX "xero_contacts_name_idx" ON "xero_contacts"("name");

-- CreateIndex
CREATE INDEX "xero_invoices_contact_id_idx" ON "xero_invoices"("contact_id");

-- CreateIndex
CREATE INDEX "xero_invoices_type_status_idx" ON "xero_invoices"("type", "status");

-- CreateIndex
CREATE INDEX "xero_invoices_due_date_idx" ON "xero_invoices"("due_date");

-- CreateIndex
CREATE INDEX "xero_invoices_date_idx" ON "xero_invoices"("date");

-- CreateIndex
CREATE INDEX "xero_invoices_updated_date_utc_idx" ON "xero_invoices"("updated_date_utc");

-- CreateIndex
CREATE INDEX "xero_credit_notes_contact_id_idx" ON "xero_credit_notes"("contact_id");

-- CreateIndex
CREATE INDEX "xero_credit_notes_type_status_idx" ON "xero_credit_notes"("type", "status");

-- CreateIndex
CREATE INDEX "xero_credit_notes_date_idx" ON "xero_credit_notes"("date");

-- CreateIndex
CREATE INDEX "xero_credit_notes_updated_date_utc_idx" ON "xero_credit_notes"("updated_date_utc");

-- CreateIndex
CREATE INDEX "xero_bank_transactions_contact_id_idx" ON "xero_bank_transactions"("contact_id");

-- CreateIndex
CREATE INDEX "xero_bank_transactions_type_status_idx" ON "xero_bank_transactions"("type", "status");

-- CreateIndex
CREATE INDEX "xero_bank_transactions_date_idx" ON "xero_bank_transactions"("date");

-- CreateIndex
CREATE INDEX "xero_bank_transactions_updated_date_utc_idx" ON "xero_bank_transactions"("updated_date_utc");

-- CreateIndex
CREATE INDEX "xero_payments_invoice_id_idx" ON "xero_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "xero_payments_credit_note_id_idx" ON "xero_payments"("credit_note_id");

-- CreateIndex
CREATE INDEX "xero_payments_contact_id_idx" ON "xero_payments"("contact_id");

-- CreateIndex
CREATE INDEX "xero_payments_date_idx" ON "xero_payments"("date");

-- CreateIndex
CREATE INDEX "xero_attachments_parent_id_idx" ON "xero_attachments"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "xero_attachments_parent_id_attachment_id_key" ON "xero_attachments"("parent_id", "attachment_id");
