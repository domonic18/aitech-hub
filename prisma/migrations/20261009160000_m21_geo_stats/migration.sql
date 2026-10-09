-- M21 GEO 统计(2026-10-09 方案A):机器专属面(llms.txt 索引 / llms-full 全文 /
-- 文章 .md 直出)× 爬虫抓取日聚合。middleware 对 GEO 路径不分名单内外一律上报,
-- 未识别 UA 记 bot_name='unknown-agent';llms 两面 post_id 以空串占位
-- (空串而非 NULL:复合主键列 NULL 会使唯一约束失效)。
-- CreateTable
CREATE TABLE "stats_geo_daily" (
    "stat_date" DATE NOT NULL,
    "surface" VARCHAR(20) NOT NULL,
    "bot_name" VARCHAR(50) NOT NULL,
    "post_id" VARCHAR(20) NOT NULL DEFAULT '',
    "pv" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stats_geo_daily_pkey" PRIMARY KEY ("stat_date","surface","bot_name","post_id")
);
