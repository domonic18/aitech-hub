-- 贴图三表(M41 渠道三,arch/05 §4.8):content_pin(贴图主实体,标题≤32码点
-- 公众号 newspic 硬上限)/ content_pin_image(有序图片,引用 ai_illu_version
-- soft ref 不拷文件,media_path 挂载时快照)/ content_pin_channel(渠道留痕,
-- 循 publish_channel 同款)。状态机 draft→pending→synced→published;
-- 首张即封面(image_list 顺序 = sort_order)。

-- CreateTable
CREATE TABLE "content_pin" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(64) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "topic_id" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "read_more_url" VARCHAR(500),
    "crop_spec" VARCHAR(40) NOT NULL DEFAULT '1_1',
    "synced_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "content_pin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_pin_image" (
    "id" BIGSERIAL NOT NULL,
    "pin_id" BIGINT NOT NULL,
    "version_id" BIGINT,
    "media_path" VARCHAR(500) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_pin_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_pin_channel" (
    "id" BIGSERIAL NOT NULL,
    "pin_id" BIGINT NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "media_id" VARCHAR(100),
    "publish_id" VARCHAR(100),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "content_pin_channel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_content_pin_status_updated" ON "content_pin"("status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_content_pin_image_pin_sort" ON "content_pin_image"("pin_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_pin_channel_pin_channel" ON "content_pin_channel"("pin_id", "channel");

-- AddForeignKey
ALTER TABLE "content_pin_image" ADD CONSTRAINT "content_pin_image_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "content_pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_pin_channel" ADD CONSTRAINT "content_pin_channel_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "content_pin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
