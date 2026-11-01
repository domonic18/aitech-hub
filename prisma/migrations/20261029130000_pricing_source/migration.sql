-- M56 批B:pricing_source 渠道注册表(URL/启停后台可调,解析器按 key 住代码)
CREATE TABLE "pricing_source" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "target" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "vendor" VARCHAR(40) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "remark" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uq_pricing_source_key" UNIQUE ("key")
);
