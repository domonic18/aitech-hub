-- 配图版本加展示名与登记口两列(F13/F14 板面「名称/来源」数据支撑):
-- 均可空、无默认(历史行保持 NULL,展示层兜底);不加约束,合法值应用层 Zod 管控。
ALTER TABLE "ai_illu_version" ADD COLUMN "name" VARCHAR(200);
ALTER TABLE "ai_illu_version" ADD COLUMN "source" VARCHAR(20);
