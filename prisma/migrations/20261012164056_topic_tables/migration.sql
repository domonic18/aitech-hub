-- AlterTable
ALTER TABLE "telegram" ADD COLUMN     "ai_note" TEXT;

-- CreateTable
CREATE TABLE "topic" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "positioning" VARCHAR(1000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'collecting',
    "linked_post_id" BIGINT,
    "composed_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_item" (
    "id" BIGSERIAL NOT NULL,
    "topic_id" BIGINT NOT NULL,
    "item_type" VARCHAR(20) NOT NULL,
    "item_id" BIGINT NOT NULL,
    "note" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_topic_status_updated" ON "topic"("status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_topic_item_topic_sort" ON "topic_item"("topic_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "uq_topic_item_identity" ON "topic_item"("topic_id", "item_type", "item_id");

-- AddForeignKey
ALTER TABLE "topic_item" ADD CONSTRAINT "topic_item_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

