-- M55:模型牌价速查页数据层(工具钩子·价格表;官方一手价人工策展,
-- 三通道数据均落 pending 终审 enabled;价格统一「货币/百万 tokens」口径)
CREATE TABLE "model_pricing" (
    "id"             BIGSERIAL       NOT NULL,
    "vendor"         VARCHAR(40)     NOT NULL,
    "model_key"      VARCHAR(60)     NOT NULL,
    "currency"       VARCHAR(8)      NOT NULL DEFAULT 'CNY',
    "input_price"    DECIMAL(12,4),
    "output_price"   DECIMAL(12,4),
    "free_tier"      VARCHAR(60),
    "context_window" VARCHAR(20),
    "note"           VARCHAR(200),
    "data_as_of"     TIMESTAMPTZ(6)  NOT NULL,
    "source_url"     VARCHAR(300)    NOT NULL,
    "region"         VARCHAR(8)      NOT NULL DEFAULT 'cn',
    "status"         VARCHAR(10)     NOT NULL DEFAULT 'pending',
    "sort_order"     INTEGER         NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMPTZ(6)  NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ(6)  NOT NULL DEFAULT now(),
    CONSTRAINT "model_pricing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_model_pricing_vendor_model" ON "model_pricing"("vendor","model_key");
CREATE INDEX "idx_model_pricing_page" ON "model_pricing"("status","region","sort_order");

CREATE TABLE "coding_plan" (
    "id"            BIGSERIAL      NOT NULL,
    "vendor"        VARCHAR(40)    NOT NULL,
    "plan_name"     VARCHAR(60)    NOT NULL,
    "currency"      VARCHAR(8)     NOT NULL DEFAULT 'CNY',
    "monthly_fee"   DECIMAL(12,2),
    "quota_desc"    VARCHAR(200)   NOT NULL,
    "peak_rate"     VARCHAR(60),
    "off_peak_rate" VARCHAR(60),
    "best_for"      VARCHAR(80),
    "data_as_of"    TIMESTAMPTZ(6) NOT NULL,
    "source_url"    VARCHAR(300)   NOT NULL,
    "status"        VARCHAR(10)    NOT NULL DEFAULT 'pending',
    "sort_order"    INTEGER        NOT NULL DEFAULT 0,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "coding_plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_coding_plan_vendor_plan" ON "coding_plan"("vendor","plan_name");
CREATE INDEX "idx_coding_plan_page" ON "coding_plan"("status","sort_order");
