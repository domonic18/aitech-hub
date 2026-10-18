-- 洞察中心 M34 批② AI 加工层(方案 docs/plan/insight-plan.md §5/§8):簇表
-- 打标/覆盖度运行列 + 信号向量 HNSW 索引(embedding <=> 余弦近邻归簇查询,
-- pgvector 扩展已于 20261008110000_hybrid_search_pgvector 建立,从零重放顺序
-- 天然满足)。label 放宽 nullable:未打标簇先入池,LLM 日批回填(批① 建表
-- NOT NULL 但批② 前无写入方,放宽无数据风险,forward-only 合规)。

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

-- CreateIndex
CREATE INDEX "insight_signal_embedding_hnsw"
    ON "insight_signal" USING hnsw ("embedding" vector_cosine_ops);
