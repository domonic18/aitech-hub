-- 混合检索(M20,arch/04 §3.2):pgvector 扩展 + search_embedding 向量表。
-- 前置:PG 镜像须含 pgvector(docker/postgres-pgvector.Dockerfile 自编译 / CI 官方
-- pgvector/pgvector:pg16);官方 postgres:16-alpine 无此扩展,migrate 会在此失败——属预期守卫。
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "search_embedding" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "dims" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1024) NOT NULL,

    CONSTRAINT "search_embedding_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "search_embedding_entity_type_entity_id_key" ON "search_embedding"("entity_type", "entity_id");

-- 三域余弦 HNSW 分部索引:检索恒带 entity_type 等值过滤,分部索引规模大后仍走 ANN;
-- HNSW 默认参数(m=16, ef_construction=64)在十万行级足够,调参届时随量评审
CREATE INDEX "search_embedding_post_hnsw"
    ON "search_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "entity_type" = 'post';
CREATE INDEX "search_embedding_telegram_hnsw"
    ON "search_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "entity_type" = 'telegram';
CREATE INDEX "search_embedding_repo_hnsw"
    ON "search_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "entity_type" = 'repo';
