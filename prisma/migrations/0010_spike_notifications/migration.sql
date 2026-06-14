-- CreateTable
CREATE TABLE "spike_notifications" (
    "id" BIGSERIAL NOT NULL,
    "clickup_user_id" TEXT NOT NULL,
    "spike_date" DATE NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "user_name" TEXT,
    "total_hours" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "rule" TEXT,
    "note" TEXT,
    "sent_by" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spike_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spike_notifications_clickup_user_id_spike_date_key" ON "spike_notifications"("clickup_user_id", "spike_date");
