-- 创作中心(M42):专题管理 → 创作中心的概念重构,数据层只做加法。
-- output_type = 主意图(article | pin),决定新建默认与 agent 分支,不限制另一
-- 种产出;pin_positioning 是贴图创作配置条款文本,与长文 positioning 独立列、
-- 互不派生。content_pin.reference_media_path 记录生图采纳的参照图(站内
-- uploads 路径,soft ref),让「按素材出图」可追溯、可复现。索引服务创作台
-- 按创作聚合贴图产出。回填只把「从没出过长文、但有贴图」的存量专题标为 pin。

-- AlterTable
ALTER TABLE "topic" ADD COLUMN "pin_positioning" VARCHAR(1000),
ADD COLUMN "output_type" VARCHAR(20) NOT NULL DEFAULT 'article';

-- AlterTable
ALTER TABLE "content_pin" ADD COLUMN "reference_media_path" VARCHAR(500);

-- CreateIndex
CREATE INDEX "idx_content_pin_topic_updated" ON "content_pin"("topic_id", "updated_at" DESC);

-- 回填(幂等):无长文锚点且有贴图挂靠的存量专题,主意图回落 pin
UPDATE "topic" t SET "output_type" = 'pin'
 WHERE t."linked_post_id" IS NULL
   AND EXISTS (SELECT 1 FROM "content_pin" p WHERE p."topic_id" = t."id");
