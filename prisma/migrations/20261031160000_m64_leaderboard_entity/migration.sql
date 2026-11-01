-- M64 榜单口径与实体层打通:榜单快照挂实体
-- 手写 SQL(仓库既有惯例:migrate dev 被 checkpointer 自建表判漂移卡死,
-- 以 psql 从零重放验证代替)。forward-only,不改已应用迁移。
-- 仅 AA / Hugging Face 两榜在采集写入时解析落值;arXiv / GitHub 恒空,
-- 未命中(上游新增模型尚未进实体表)同样留空且不阻塞采集。

ALTER TABLE "insight_leaderboard_snapshot" ADD COLUMN "entity_id" BIGINT;

CREATE INDEX "idx_insight_leaderboard_snapshot_entity" ON "insight_leaderboard_snapshot"("entity_id");

ALTER TABLE "insight_leaderboard_snapshot"
    ADD CONSTRAINT "insight_leaderboard_snapshot_entity_id_fkey"
    FOREIGN KEY ("entity_id") REFERENCES "insight_entity"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
