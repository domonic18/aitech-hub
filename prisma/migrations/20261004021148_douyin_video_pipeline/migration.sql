-- AlterTable
ALTER TABLE "telegram" ADD COLUMN     "media_type" VARCHAR(10) NOT NULL DEFAULT 'text',
ADD COLUMN     "video_blogger" VARCHAR(100),
ADD COLUMN     "video_cover_url" VARCHAR(1000),
ADD COLUMN     "video_duration" INTEGER,
ADD COLUMN     "video_engagement" JSONB,
ADD COLUMN     "video_platform" VARCHAR(20);

-- CreateTable
CREATE TABLE "social_account" (
    "id" SERIAL NOT NULL,
    "platform_row_id" INTEGER NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "sec_uid" VARCHAR(100) NOT NULL,
    "nickname" VARCHAR(100) NOT NULL,
    "avatar_url" VARCHAR(1000),
    "category" VARCHAR(50),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "crawl_interval_min" INTEGER NOT NULL DEFAULT 180,
    "last_post_at" TIMESTAMPTZ(6),
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "consecutive_fails" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "remark" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_social_account_due" ON "social_account"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "idx_social_account_platform_row" ON "social_account"("platform_row_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_social_account_platform_sec_uid" ON "social_account"("platform", "sec_uid");

-- CreateIndex
CREATE INDEX "idx_telegram_status_media" ON "telegram"("status", "media_type");

-- AddForeignKey
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_platform_row_id_fkey" FOREIGN KEY ("platform_row_id") REFERENCES "crawl_source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
