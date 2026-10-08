-- CreateTable
CREATE TABLE "stats_search_log" (
    "id" BIGSERIAL NOT NULL,
    "term" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stats_search_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_stats_search_log_created_at" ON "stats_search_log"("created_at" DESC);
