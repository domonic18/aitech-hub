-- 洞察中心 M34 批①(方案 docs/plan/insight-plan.md §4):信号池四表 + 搜索词命中数增强。
-- insight_signal=五介质痕迹模型原始信号行(批① 内部零采集源,批③④ 外部源接入);
-- cluster/member/snapshot 为批② 聚类产物容器,一次建齐免二次迁移。embedding 列
-- nullable vector(1024) 批② 回填(SearchEmbedding 同款;pgvector 扩展已于
-- 20261008110000_hybrid_search_pgvector 建立,从零重放顺序天然满足)。
-- member/snapshot 同域 FK Cascade:信号/簇删除自动收尸,不靠应用层。

-- AlterTable
ALTER TABLE "stats_search_log" ADD COLUMN "hit_count" INTEGER;

-- CreateTable
CREATE TABLE "insight_signal" (
    "id" BIGSERIAL NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "domain" VARCHAR(20) NOT NULL DEFAULT 'tech',
    "medium" VARCHAR(12) NOT NULL,
    "ref_id" VARCHAR(120) NOT NULL,
    "raw_text" TEXT NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "meta" JSONB,
    "embedding" vector(1024),
    "signal_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_cluster" (
    "id" BIGSERIAL NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "domain" VARCHAR(20) NOT NULL DEFAULT 'tech',
    "label" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(1000),
    "keywords" JSONB,
    "media" JSONB,
    "score" DOUBLE PRECISION,
    "status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "peak_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "insight_cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_cluster_member" (
    "id" BIGSERIAL NOT NULL,
    "cluster_id" BIGINT NOT NULL,
    "signal_id" BIGINT NOT NULL,
    "weight" DOUBLE PRECISION,

    CONSTRAINT "insight_cluster_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "cluster_id" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER,

    CONSTRAINT "insight_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_insight_signal_source_ref" ON "insight_signal"("source", "ref_id");

-- CreateIndex
CREATE INDEX "idx_insight_signal_recent" ON "insight_signal"("signal_at" DESC);

-- CreateIndex
CREATE INDEX "idx_insight_signal_source_recent" ON "insight_signal"("source", "signal_at" DESC);

-- CreateIndex
CREATE INDEX "idx_insight_cluster_kind_status" ON "insight_cluster"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_insight_cluster_member" ON "insight_cluster_member"("cluster_id", "signal_id");

-- CreateIndex
CREATE INDEX "idx_insight_cluster_member_signal" ON "insight_cluster_member"("signal_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_insight_snapshot_cluster_date" ON "insight_snapshot"("cluster_id", "date");

-- AddForeignKey
ALTER TABLE "insight_cluster_member" ADD CONSTRAINT "insight_cluster_member_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "insight_cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_cluster_member" ADD CONSTRAINT "insight_cluster_member_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "insight_signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_snapshot" ADD CONSTRAINT "insight_snapshot_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "insight_cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
