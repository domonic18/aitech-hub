-- M58 批①:信号多语言与地域基座(海外源中文化统一视图)
-- 存量信号全部来自国内中文源 → 回填 zh/cn;译文状态 none 即「无需翻译」。
-- 簇地域在打标时按成员多数派回写;存量簇同样回填 cn,避免旧卡无徽章。
ALTER TABLE "insight_signal"
    ADD COLUMN "lang" VARCHAR(10),
    ADD COLUMN "region" VARCHAR(10),
    ADD COLUMN "translated_text" TEXT,
    ADD COLUMN "translation_status" VARCHAR(10) NOT NULL DEFAULT 'none';

UPDATE "insight_signal"
SET "lang" = 'zh',
    "region" = 'cn'
WHERE "lang" IS NULL;

CREATE INDEX "idx_insight_signal_region_recent" ON "insight_signal"("region", "signal_at" DESC);

ALTER TABLE "insight_cluster" ADD COLUMN "region" VARCHAR(10);

UPDATE "insight_cluster" SET "region" = 'cn' WHERE "region" IS NULL;
