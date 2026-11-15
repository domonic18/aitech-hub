-- 站内创作台账(专题)体系退役(M72 瘦身,2026-11-15,用户拍板「彻底删」):
-- 创作职责已整体外移线下 Claude Code(MCP 25 只工具 + 仓库 skills/writing/*.md),
-- 站内的 Topic 台账(素材攒集 + 写作配置 + 关联稿)不再是取料必需,整层删除。
--
-- 删除面:
--   topic              创作项目(定位/贴图配置/绑定指南/关联稿/状态机)
--   topic_item         创作挂载的素材条目(电报/文章 + 人工批注 + 排序)
--   writing_sample_image 样例参照图库(只服务于 topic.sample_image_id 与
--                       站内 agent 生图参照;站内生图随写工具下线,图本身留媒体库)
--   content_pin.topic_id 贴图与创作的关联列(FK SetNull)
--
-- 数据无损失:贴图与文章本体不删(topic 侧只存关联,主数据在 content_pin /
-- content_post);写作指南真相源在仓库 skills/writing/*.md(B2 已逐个 md5 比对,
-- 与生产 agent_skill 表零漂移,站内版随 agent 写工具下线一并退役)。
-- 存量规则迁移:价格表稿的公众号「阅读原文」落点原由 topic.skill_key 判别
-- (M55 批E);创作台账下线后改由文章标签 slug=model-pricing 承载——
-- 先建标签并按 topic 关联回填,存量价格稿不丢这条互链规则。
INSERT INTO "content_tag" ("slug", "name", "created_at")
VALUES ('model-pricing', '牌价速查', now())
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "content_post_tag" ("post_id", "tag_id", "created_at")
SELECT p."id", t."id", now()
FROM "topic" tp
JOIN "content_tag" t ON t."slug" = 'model-pricing'
JOIN "content_post" p ON p."id" = tp."linked_post_id"
WHERE tp."skill_key" = 'model-pricing'
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS "topic_item";

DROP TABLE IF EXISTS "writing_sample_image";

DROP TABLE IF EXISTS "topic";

-- 贴图去「绑定主题」列(SetNull 语义:删专题只清关联,贴图保留)
ALTER TABLE "content_pin" DROP COLUMN IF EXISTS "topic_id";

DROP INDEX IF EXISTS "idx_content_pin_topic_updated";
