-- 写作指南台账退役(M72 瘦身 B7,D7 裁定):`agent_skill` 表删除。
--
-- 真相源已迁到仓库 `skills/writing/*.md`(B2):站内 agent 侧改读站内版常量
-- (`src/lib/ai/writing-guides.ts`),MCP `list_skills`/`get_skill` 与素材包导出
-- 读仓库 md(线下语境版)。后台「写作技能」页与 `/api/agent-skills/**` 一并下线
-- ——改指南不再需要「建表 → 后台编辑 → 发版」,改仓库文件即生效。
--
-- 无数据损失:B2 导出时已把生产表 `guide_md` 与站内常量逐个 md5 比对(零漂移),
-- 仓库 md 即是这份内容的完整副本(名称/场景取生产现值)。
DROP TABLE IF EXISTS "agent_skill";
