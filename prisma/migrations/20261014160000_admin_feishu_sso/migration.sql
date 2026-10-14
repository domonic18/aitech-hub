-- M29 批①:飞书工作台免登——配置单例 + admin 绑定表(免登白名单本体)。
-- forward-only;绑定表无 DB 外键(应用层完整性,plan M29 定稿)。

CREATE TABLE "admin_feishu_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "app_id" VARCHAR(50) NOT NULL DEFAULT '',
    "app_secret_enc" VARCHAR(500),
    "app_secret_mask" VARCHAR(20),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_tested_at" TIMESTAMPTZ(6),
    "last_test_status" VARCHAR(10),
    "last_test_error" VARCHAR(500),
    "last_test_latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_feishu_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_feishu_binding" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "union_id" VARCHAR(64) NOT NULL,
    "open_id" VARCHAR(64) NOT NULL,
    "feishu_name" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_feishu_binding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_admin_feishu_binding_user" ON "admin_feishu_binding"("user_id");
CREATE UNIQUE INDEX "uq_admin_feishu_binding_union" ON "admin_feishu_binding"("union_id");
