-- 热榜源登记(M34 批③ 验收反馈:纳入采集计划管理,docs/plan/insight-plan.md §8.1)
-- fetcher 注册表的运行态投影:运行时启停 + 逐源拉取态回写(crawl_source 同口径)。
-- 缺行按启用处理(读侧懒登记),此 seed 仅初始化在役三源便于台账直出。

CREATE TABLE "insight_hot_source" (
    "source" VARCHAR(30) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_fails" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_hot_source_pkey" PRIMARY KEY ("source")
);

INSERT INTO "insight_hot_source" ("source")
VALUES ('hot-baidu'), ('hot-zhihu'), ('hot-bilibili')
ON CONFLICT ("source") DO NOTHING;
