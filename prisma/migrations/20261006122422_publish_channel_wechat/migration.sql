-- CreateTable
CREATE TABLE "publish_wechat_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "appid" VARCHAR(50) NOT NULL,
    "app_secret_enc" VARCHAR(500),
    "app_secret_mask" VARCHAR(20),
    "author" VARCHAR(64),
    "auto_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_tested_at" TIMESTAMPTZ(6),
    "last_test_status" VARCHAR(10),
    "last_test_error" VARCHAR(500),
    "last_test_latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_wechat_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_channel" (
    "id" BIGSERIAL NOT NULL,
    "post_id" BIGINT NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "media_id" VARCHAR(100),
    "title" VARCHAR(500),
    "digest" VARCHAR(500),
    "thumb_path" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_media_cache" (
    "id" BIGSERIAL NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "source_key" VARCHAR(64) NOT NULL,
    "source_url" VARCHAR(1000),
    "remote_url" VARCHAR(1000) NOT NULL,
    "remote_media_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_media_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_publish_channel_channel_status" ON "publish_channel"("channel", "status");

-- CreateIndex
CREATE INDEX "idx_publish_channel_updated" ON "publish_channel"("updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_publish_channel_post_channel" ON "publish_channel"("post_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "uq_publish_media_channel_key" ON "publish_media_cache"("channel", "source_key");

-- AddForeignKey
ALTER TABLE "publish_channel" ADD CONSTRAINT "publish_channel_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
