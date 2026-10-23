-- 候选治理 F24「合并 = 作为已有词的别名」:discovery_keyword 加 merged_into_id
-- (self-FK,SetNull:目标词被删则别名回落孤行,不再悬挂)。status 注释增
-- 'merged',PG 无约束变化,仅列 + FK + 索引。
ALTER TABLE "discovery_keyword"
    ADD COLUMN "merged_into_id" BIGINT;

CREATE INDEX "idx_discovery_keyword_merged_into" ON "discovery_keyword"("merged_into_id");

ALTER TABLE "discovery_keyword"
    ADD CONSTRAINT "discovery_keyword_merged_into_id_fkey"
    FOREIGN KEY ("merged_into_id") REFERENCES "discovery_keyword"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
