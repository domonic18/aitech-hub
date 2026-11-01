-- 2026-10-29 采集快照元数据表(P0 回溯档案):取数原文归档到私有备份桶,
-- 本表存元数据供后台按源/时间/解析状态筛选(不靠 COS listAll 翻页)。
-- 解析失败也落快照;保留每源最近 N 份,采集后清理,COS 生命周期兜底。
CREATE TABLE "crawl_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" VARCHAR(500) NOT NULL,
    "tab" VARCHAR(40),
    "http_status" INTEGER,
    "size_bytes" INTEGER NOT NULL,
    "sha1" CHAR(40) NOT NULL,
    "parse_status" VARCHAR(12) NOT NULL DEFAULT 'pending',
    "row_count" INTEGER,
    "error" TEXT,
    "storage_key" VARCHAR(300) NOT NULL,
    "has_png" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "crawl_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_crawl_snapshot_source_recent" ON "crawl_snapshot"("source_id", "captured_at" DESC);

ALTER TABLE "crawl_snapshot"
    ADD CONSTRAINT "crawl_snapshot_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "crawl_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
