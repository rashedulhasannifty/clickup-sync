-- CreateTable
CREATE TABLE "spike_resolutions" (
    "id" BIGSERIAL NOT NULL,
    "clickup_user_id" TEXT NOT NULL,
    "spike_date" DATE NOT NULL,
    "user_name" TEXT,
    "note" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spike_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spike_resolutions_clickup_user_id_spike_date_key" ON "spike_resolutions"("clickup_user_id", "spike_date");
