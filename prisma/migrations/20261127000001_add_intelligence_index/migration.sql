-- AlterTable
-- 先带默认值补列(表可能已有行),再摘掉默认值:
-- 列最终形状与 schema.prisma 一致(NOT NULL 且无 DEFAULT),不留 schema 漂移
ALTER TABLE "ai_index_daily" ADD COLUMN "intelligence_index" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ai_index_daily" ALTER COLUMN "intelligence_index" DROP DEFAULT;
