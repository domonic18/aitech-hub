-- 采集能否覆盖本行,与前台展示态解耦(M73):
-- 原来「终审行(enabled/disabled)采集不覆盖」这条规则借 status 表达,把
-- 「是否展示」与「是否人工定稿」挤进一列 —— 于是「停用展示但希望价格跟随
-- 官方」无法表达,过期价格只能靠人工改库。新增 is_pinned 专表「人工定稿」。
--
-- 存量回填:前台展示中(enabled)的行置人工定稿,保持「采集不覆盖已展示价格」
-- 的现状语义不变;其余行(pending/disabled)允许采集刷新 —— 停用态的行刷新
-- 不影响前台展示,却让数据保持新鲜(将来上架时不用先补价)。
ALTER TABLE "coding_plan" ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false;

UPDATE "coding_plan" SET "is_pinned" = true WHERE "status" = 'enabled';

-- AlterTable
ALTER TABLE "model_pricing" ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false;

UPDATE "model_pricing" SET "is_pinned" = true WHERE "status" = 'enabled';
