-- CreateTable
CREATE TABLE "stats_visit_log" (
    "id" BIGSERIAL NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "browser" VARCHAR(50) NOT NULL,
    "os" VARCHAR(50) NOT NULL,
    "device_type" VARCHAR(20) NOT NULL,
    "source_class" VARCHAR(20) NOT NULL,
    "source_name" VARCHAR(50) NOT NULL,
    "visitor_hash" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stats_visit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_stats_visit_log_created_at" ON "stats_visit_log"("created_at" DESC);
