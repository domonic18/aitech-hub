-- CreateTable
CREATE TABLE "crawl_source" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "platform" VARCHAR(20),
    "url" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "crawl_interval_min" INTEGER NOT NULL DEFAULT 30,
    "daily_max_requests" INTEGER,
    "consecutive_fails" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'healthy',
    "config" JSONB,
    "remark" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawl_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram" (
    "id" BIGSERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "title" VARCHAR(500),
    "summary" VARCHAR(1000) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "content_hash" CHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'visible',
    "filter_hit" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocklist" (
    "id" SERIAL NOT NULL,
    "word" VARCHAR(100) NOT NULL,
    "scope" VARCHAR(10) NOT NULL DEFAULT 'all',
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_crawl_source_name" ON "crawl_source"("name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_telegram_content_hash" ON "telegram"("content_hash");

-- CreateIndex
CREATE INDEX "idx_telegram_status_published" ON "telegram"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "idx_telegram_source_created" ON "telegram"("source_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blocklist_word" ON "blocklist"("word");

-- AddForeignKey
ALTER TABLE "telegram" ADD CONSTRAINT "telegram_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crawl_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
