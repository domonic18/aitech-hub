-- CreateTable
CREATE TABLE "ai_index_eci_model" (
    "id" BIGSERIAL NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "eci" DOUBLE PRECISION NOT NULL,
    "ci_low" DOUBLE PRECISION NOT NULL,
    "ci_high" DOUBLE PRECISION NOT NULL,
    "eci_date" DATE NOT NULL,
    "organization" VARCHAR(120) NOT NULL,
    "country" VARCHAR(60),
    "accessibility" VARCHAR(40),
    "accessibility_group" VARCHAR(60),
    "source_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_index_eci_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_index_eci_sync" (
    "id" BIGSERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(16) NOT NULL,
    "http_status" INTEGER,
    "content_hash" CHAR(64),
    "model_count" INTEGER,
    "frontier_eci" DOUBLE PRECISION,
    "changed_models" INTEGER,
    "duration_ms" INTEGER,
    "error" TEXT,

    CONSTRAINT "ai_index_eci_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_index_event_score" (
    "id" BIGSERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "summary" TEXT NOT NULL,
    "source_name" VARCHAR(120),
    "url" VARCHAR(500),
    "impact_score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "dimension" VARCHAR(20) NOT NULL,
    "relevance" VARCHAR(12) NOT NULL,
    "direction" VARCHAR(12) NOT NULL,
    "scorer" VARCHAR(10) NOT NULL,
    "scored_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_index_event_score_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_index_eci_model_model" ON "ai_index_eci_model"("model");

-- CreateIndex
CREATE INDEX "idx_ai_index_eci_model_eci_date" ON "ai_index_eci_model"("eci_date");

-- CreateIndex
CREATE INDEX "idx_ai_index_eci_sync_recent" ON "ai_index_eci_sync"("fetched_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_ai_index_event_score_telegram_id" ON "ai_index_event_score"("telegram_id");

-- CreateIndex
CREATE INDEX "idx_ai_index_event_score_published_at" ON "ai_index_event_score"("published_at");

