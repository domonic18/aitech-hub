-- M28 批①:条目点击明细 stats_click_log(首页/电报流条目点击行为统计;
-- 行级直插不经缓冲,无 PII——无 IP/无访客哈希,循 stats_search_log 先例
-- 180 天保留,worker 日清)。ref 无外键:telegram/post 存 BigInt id 文本、
-- project 存冻结 slug,标题查询侧反解(删行/删文 title 查询侧兜底)。

CREATE TABLE "stats_click_log" (
    "id" BIGSERIAL NOT NULL,
    "surface" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "ref" VARCHAR(100) NOT NULL,
    "domain" VARCHAR(100) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stats_click_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_stats_click_log_created_at" ON "stats_click_log"("created_at" DESC);
