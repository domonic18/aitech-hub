-- 洞察中心 M34 批② AI 加工层(方案 docs/plan/insight-plan.md §5/§8):簇表
-- 打标/覆盖度运行列。label 放宽 nullable:未打标簇先入池,LLM 日批回填(批①
-- 建表 NOT NULL 但批② 前无写入方,放宽无数据风险,forward-only 合规)。
-- 注:信号向量 HNSW 索引不随本批建——批② 归簇走成员 min-join、覆盖度走
-- avg 质心,均非 HNSW 服务的 ORDER BY 近邻形态;外部源洪峰(批③④)前随
-- 质心表分层一并补(见 src/lib/insight/embedding-repo.ts 扩容锚)。

-- AlterTable
ALTER TABLE "insight_cluster" ALTER COLUMN "label" DROP NOT NULL;

-- AlterTable
ALTER TABLE "insight_cluster" ADD COLUMN "labeled_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "insight_cluster" ADD COLUMN "labeled_member_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "insight_cluster" ADD COLUMN "coverage_score" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "insight_cluster" ADD COLUMN "coverage_state" VARCHAR(10);
