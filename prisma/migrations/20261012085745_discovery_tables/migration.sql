-- CreateTable
CREATE TABLE "discovery_keyword" (
    "id" BIGSERIAL NOT NULL,
    "word" VARCHAR(100) NOT NULL,
    "origin" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "source" VARCHAR(30),
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_candidate" (
    "id" BIGSERIAL NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "round" VARCHAR(8) NOT NULL,
    "title" VARCHAR(500),
    "author" VARCHAR(100),
    "homepage_url" VARCHAR(500),
    "hit_keywords" JSONB,
    "hit_count" INTEGER,
    "max_play" INTEGER,
    "total_play" INTEGER,
    "fans" INTEGER,
    "archives" INTEGER,
    "sample_titles" JSONB,
    "l0_verdict" VARCHAR(10) NOT NULL,
    "l0_reason" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "feishu_record_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_discovery_keyword_word" ON "discovery_keyword"("word");

-- CreateIndex
CREATE INDEX "idx_discovery_candidate_status_type" ON "discovery_candidate"("status", "type");

-- CreateIndex
CREATE INDEX "idx_discovery_candidate_round" ON "discovery_candidate"("round");

-- CreateIndex
CREATE UNIQUE INDEX "uq_discovery_candidate_identity" ON "discovery_candidate"("type", "platform", "external_id");

