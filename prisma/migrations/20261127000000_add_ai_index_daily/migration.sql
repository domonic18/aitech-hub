-- CreateTable
CREATE TABLE "ai_index_daily" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "capability" DOUBLE PRECISION,
    "velocity" DOUBLE PRECISION NOT NULL,
    "acceleration" DOUBLE PRECISION NOT NULL,
    "event_count" INTEGER NOT NULL,
    "top_events" JSONB,
    "dimensions" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_index_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_index_daily_date" ON "ai_index_daily"("date");

-- CreateIndex
CREATE INDEX "idx_ai_index_daily_date" ON "ai_index_daily"("date");
