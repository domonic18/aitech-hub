-- M62 数据库命名规范化与结构收口(2026-10-31)
-- 批A 表名/索引/主键规范 · 批B 引用完整性(15 处 FK) · 批C 审计字段(5 张表)
-- 口径:不改历史迁移;既有库原地 ALTER,从零建库重放得到完全一致的终态
-- (CI migrate-replay 守卫以 `migrate diff --exit-code` 断言)。

-- ════════════════════════════════════════════════════════════════
-- 批A-1 表重命名:entity_event → insight_entity_event
-- Prisma 不会生成 ALTER TABLE RENAME,这里手写;连带改名 PK/FK/唯一/普通索引
-- 否则 introspect 守卫会永久报差异。
-- ════════════════════════════════════════════════════════════════
ALTER TABLE "entity_event" RENAME TO "insight_entity_event";
ALTER TABLE "insight_entity_event" RENAME CONSTRAINT "entity_event_pkey" TO "insight_entity_event_pkey";
ALTER TABLE "insight_entity_event" RENAME CONSTRAINT "entity_event_entity_id_fkey" TO "insight_entity_event_entity_id_fkey";
ALTER INDEX "uq_entity_event_dedupe" RENAME TO "uq_insight_entity_event_dedupe";
ALTER INDEX "idx_entity_event_vendor_recent" RENAME TO "idx_insight_entity_event_vendor_recent";
ALTER INDEX "idx_entity_event_type_recent" RENAME TO "idx_insight_entity_event_type_recent";
ALTER INDEX "idx_entity_event_entity_recent" RENAME TO "idx_insight_entity_event_entity_recent";
ALTER INDEX "idx_entity_event_entity_id" RENAME TO "idx_insight_entity_event_entity_id";

-- ════════════════════════════════════════════════════════════════
-- 批A-1 表重命名:leaderboard_snapshot → insight_leaderboard_snapshot
-- ════════════════════════════════════════════════════════════════
ALTER TABLE "leaderboard_snapshot" RENAME TO "insight_leaderboard_snapshot";
ALTER TABLE "insight_leaderboard_snapshot" RENAME CONSTRAINT "leaderboard_snapshot_pkey" TO "insight_leaderboard_snapshot_pkey";
ALTER INDEX "uq_leaderboard_snapshot" RENAME TO "uq_insight_leaderboard_snapshot";
ALTER INDEX "idx_leaderboard_snapshot_board" RENAME TO "idx_insight_leaderboard_snapshot_board";

-- ════════════════════════════════════════════════════════════════
-- 批A-4 pgvector 部分索引(裸 SQL 建,schema 无法表达)补 idx_ 前缀
-- ════════════════════════════════════════════════════════════════
ALTER INDEX "search_embedding_post_hnsw" RENAME TO "idx_search_embedding_post_hnsw";
ALTER INDEX "search_embedding_telegram_hnsw" RENAME TO "idx_search_embedding_telegram_hnsw";
ALTER INDEX "search_embedding_repo_hnsw" RENAME TO "idx_search_embedding_repo_hnsw";

-- ════════════════════════════════════════════════════════════════
-- 批A-5 点赞表补复合主键(唯一索引 → PK;两表 0 行)
-- ════════════════════════════════════════════════════════════════
DROP INDEX "uq_content_post_like_post_identity";
ALTER TABLE "content_post_like" ADD CONSTRAINT "content_post_like_pkey" PRIMARY KEY ("post_id", "identity_key");

DROP INDEX "uq_content_post_comment_like_comment_identity";
ALTER TABLE "content_post_comment_like" ADD CONSTRAINT "content_post_comment_like_pkey" PRIMARY KEY ("comment_id", "identity_key");

-- ════════════════════════════════════════════════════════════════
-- 批B 前置:ai_cover_candidate.model_id 可空(模型物理删后候选留档)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE "ai_cover_candidate" ALTER COLUMN "model_id" DROP NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 批B 前置:user_token_ledger.session_id 对齐 search_agent_session.id 类型
-- (Prisma relation 要求两侧 native type 一致;UUID 恒 36 字符)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE "user_token_ledger" ALTER COLUMN "session_id" SET DATA TYPE VARCHAR(36);

-- ════════════════════════════════════════════════════════════════
-- 批C 审计字段:5 张明细表补 created_at
-- 三步走(加可空 → 从父表回填真实时间 → 设默认+NOT NULL),避免新列值
-- 全落成迁移时刻的假数据。借不到父时间的行回落迁移时刻(下方逐条注明)。
-- ════════════════════════════════════════════════════════════════

-- C1 pay_order_item ← pay_order.created_at
ALTER TABLE "pay_order_item" ADD COLUMN "created_at" TIMESTAMPTZ(6);
UPDATE "pay_order_item" AS i
   SET "created_at" = o."created_at"
  FROM "pay_order" AS o
 WHERE i."order_id" = o."id";
UPDATE "pay_order_item" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
ALTER TABLE "pay_order_item" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "pay_order_item" ALTER COLUMN "created_at" SET NOT NULL;

-- C2 content_post_tag ← content_post.published_at(未发布回落到 created_at)
ALTER TABLE "content_post_tag" ADD COLUMN "created_at" TIMESTAMPTZ(6);
UPDATE "content_post_tag" AS t
   SET "created_at" = COALESCE(p."published_at", p."created_at")
  FROM "content_post" AS p
 WHERE t."post_id" = p."id";
UPDATE "content_post_tag" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
ALTER TABLE "content_post_tag" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "content_post_tag" ALTER COLUMN "created_at" SET NOT NULL;

-- C3 content_media_ref ← content_post.created_at
ALTER TABLE "content_media_ref" ADD COLUMN "created_at" TIMESTAMPTZ(6);
UPDATE "content_media_ref" AS m
   SET "created_at" = p."created_at"
  FROM "content_post" AS p
 WHERE m."post_id" = p."id";
UPDATE "content_media_ref" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
ALTER TABLE "content_media_ref" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "content_media_ref" ALTER COLUMN "created_at" SET NOT NULL;

-- C4 github_repo_post ← content_post.published_at(未发布回落到 created_at)
ALTER TABLE "github_repo_post" ADD COLUMN "created_at" TIMESTAMPTZ(6);
UPDATE "github_repo_post" AS g
   SET "created_at" = COALESCE(p."published_at", p."created_at")
  FROM "content_post" AS p
 WHERE g."post_id" = p."id";
UPDATE "github_repo_post" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
ALTER TABLE "github_repo_post" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "github_repo_post" ALTER COLUMN "created_at" SET NOT NULL;

-- C5 insight_cluster_member ← insight_cluster.created_at
ALTER TABLE "insight_cluster_member" ADD COLUMN "created_at" TIMESTAMPTZ(6);
UPDATE "insight_cluster_member" AS m
   SET "created_at" = c."created_at"
  FROM "insight_cluster" AS c
 WHERE m."cluster_id" = c."id";
UPDATE "insight_cluster_member" SET "created_at" = CURRENT_TIMESTAMP WHERE "created_at" IS NULL;
ALTER TABLE "insight_cluster_member" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "insight_cluster_member" ALTER COLUMN "created_at" SET NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 批A-3 唯一索引命名补正(Prisma 默认名 → uq_ 规范)
-- ════════════════════════════════════════════════════════════════
ALTER INDEX "insight_entity_key_key" RENAME TO "uq_insight_entity_key";
ALTER INDEX "insight_entity_match_key_key" RENAME TO "uq_insight_entity_match_key";
ALTER INDEX "insight_entity_alias_alias_key_key" RENAME TO "uq_insight_entity_alias_alias_key";
ALTER INDEX "insight_taxonomy_key_key" RENAME TO "uq_insight_taxonomy_key";
ALTER INDEX "search_embedding_entity_type_entity_id_key" RENAME TO "uq_search_embedding_entity_type_entity_id";

-- ════════════════════════════════════════════════════════════════
-- 批B 补索引(PG 不会为 FK 自动建索引)
-- ════════════════════════════════════════════════════════════════
CREATE INDEX "idx_ai_cover_candidate_model" ON "ai_cover_candidate"("model_id");
CREATE INDEX "idx_ai_task_binding_primary" ON "ai_task_binding"("primary_id");
CREATE INDEX "idx_ai_task_binding_backup" ON "ai_task_binding"("backup_id");
CREATE INDEX "idx_ai_usage_log_model" ON "ai_usage_log"("model_id");
CREATE INDEX "idx_content_post_comment_parent" ON "content_post_comment"("parent_id");
CREATE INDEX "idx_content_post_purchase_order" ON "content_post_purchase"("order_id");
CREATE INDEX "idx_content_post_tag_tag" ON "content_post_tag"("tag_id");
CREATE INDEX "idx_insight_entity_merged_into" ON "insight_entity"("merged_into_id");
CREATE INDEX "idx_pay_order_item_order" ON "pay_order_item"("order_id");

-- ════════════════════════════════════════════════════════════════
-- 批B 新增 15 处外键(onDelete 依实际删除路径逐条裁定,见 M62 计划)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE "content_post_comment" ADD CONSTRAINT "content_post_comment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_post_comment" ADD CONSTRAINT "content_post_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "content_post_comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pay_order" ADD CONSTRAINT "pay_order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pay_order_item" ADD CONSTRAINT "pay_order_item_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_post_purchase" ADD CONSTRAINT "content_post_purchase_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_post_purchase" ADD CONSTRAINT "content_post_purchase_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_post_purchase" ADD CONSTRAINT "content_post_purchase_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pay_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "insight_entity" ADD CONSTRAINT "insight_entity_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "insight_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_cover_candidate" ADD CONSTRAINT "ai_cover_candidate_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_cover_candidate" ADD CONSTRAINT "ai_cover_candidate_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_pin" ADD CONSTRAINT "content_pin_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_token_ledger" ADD CONSTRAINT "user_token_ledger_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "search_agent_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
