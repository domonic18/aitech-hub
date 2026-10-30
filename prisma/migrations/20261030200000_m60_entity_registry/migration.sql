-- M60 实体解析:实体主表 + 别名表 + entity_event 挂载
-- 手写 SQL(仓库既有惯例:migrate dev 被 checkpointer 自建表判漂移卡死,
-- 以 psql 从零重放验证代替)。forward-only,不改已应用迁移。

CREATE TABLE "insight_entity" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "match_key" VARCHAR(120) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(12) NOT NULL,
    "vendor_key" VARCHAR(30),
    "parent_id" BIGINT,
    "status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "merged_into_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "insight_entity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "insight_entity_key_key" ON "insight_entity"("key");
CREATE UNIQUE INDEX "insight_entity_match_key_key" ON "insight_entity"("match_key");
CREATE INDEX "idx_insight_entity_vendor" ON "insight_entity"("vendor_key");
CREATE INDEX "idx_insight_entity_parent" ON "insight_entity"("parent_id");

CREATE TABLE "insight_entity_alias" (
    "id" BIGSERIAL NOT NULL,
    "alias_key" VARCHAR(120) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "origin" VARCHAR(10) NOT NULL,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "insight_entity_alias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "insight_entity_alias_alias_key_key" ON "insight_entity_alias"("alias_key");
CREATE INDEX "idx_insight_entity_alias_entity" ON "insight_entity_alias"("entity_id");

ALTER TABLE "insight_entity"
    ADD CONSTRAINT "insight_entity_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "insight_entity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "insight_entity_alias"
    ADD CONSTRAINT "insight_entity_alias_entity_id_fkey"
    FOREIGN KEY ("entity_id") REFERENCES "insight_entity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "entity_event" ADD COLUMN "entity_id" BIGINT;

CREATE INDEX "idx_entity_event_entity_id" ON "entity_event"("entity_id");

ALTER TABLE "entity_event"
    ADD CONSTRAINT "entity_event_entity_id_fkey"
    FOREIGN KEY ("entity_id") REFERENCES "insight_entity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
