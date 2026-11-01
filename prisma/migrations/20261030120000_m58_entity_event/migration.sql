-- M58 批②:厂商事件层(entity_event)
-- 厂商官方发布经事件抽取落本表;dedupe_key = sha1(source|canonical url|eventType|
-- entityKey),唯一索引即幂等锚——同一快照重跑两次事件数不增。
CREATE TABLE "entity_event" (
    "id" BIGSERIAL NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "vendor" VARCHAR(30) NOT NULL,
    "entity_type" VARCHAR(12) NOT NULL,
    "entity_key" VARCHAR(120) NOT NULL,
    "event_type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "summary" VARCHAR(1000),
    "url" VARCHAR(500) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "dedupe_key" CHAR(40) NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_entity_event_dedupe" ON "entity_event"("dedupe_key");
CREATE INDEX "idx_entity_event_vendor_recent" ON "entity_event"("vendor", "occurred_at" DESC);
CREATE INDEX "idx_entity_event_type_recent" ON "entity_event"("event_type", "occurred_at" DESC);
