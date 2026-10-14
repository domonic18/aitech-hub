-- M33 批B:系统出口代理单例(全局单点家宽出口,plan M33)。
-- forward-only;配置单例无外键,镜像 admin_feishu_config 四件套。

CREATE TABLE "system_proxy_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "proxy_url_enc" VARCHAR(500),
    "proxy_url_mask" VARCHAR(60),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_tested_at" TIMESTAMPTZ(6),
    "last_test_status" VARCHAR(10),
    "last_test_error" VARCHAR(500),
    "last_test_latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_proxy_config_pkey" PRIMARY KEY ("id")
);
