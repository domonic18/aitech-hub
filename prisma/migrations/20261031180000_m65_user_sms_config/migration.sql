-- M65:短信登录配置单例(阿里云号码认证服务 PNVS「短信认证」通道)
-- 单行表:应用层只允许 id=1;accessKeySecret 密文入库(secret-box AES-256-GCM)。
CREATE TABLE "user_sms_config" (
    "id" integer NOT NULL DEFAULT 1,
    "access_key_id" varchar(100) NOT NULL DEFAULT '',
    "access_key_secret_enc" varchar(500),
    "access_key_secret_mask" varchar(20),
    "sign_name" varchar(50) NOT NULL DEFAULT '',
    "template_code" varchar(50) NOT NULL DEFAULT '100001',
    "enabled" boolean NOT NULL DEFAULT false,
    "daily_limit" integer NOT NULL DEFAULT 200,
    "last_tested_at" timestamptz(6),
    "last_test_status" varchar(10),
    "last_test_error" varchar(500),
    "last_test_latency_ms" integer,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sms_config_pkey" PRIMARY KEY ("id")
);
