-- M66:公众号私信入站会话域六表(`channel_` 前缀,arch/03 §2.4 + plan/wechat-mp-bot-plan)
-- 被动回复 5 秒窗口 + 站内检索答案 + 转人工线索;凭据列走 secret-box 密文。
-- 注意:appid/appsecret 不在此域重复存,一律经 publish_wechat_config 单源读取
-- (同号同凭据;本域只存入站服务器配置 Token/EncodingAESKey)。

-- CreateTable
CREATE TABLE "channel_wechat_mp_config" (
    "id" integer NOT NULL DEFAULT 1,
    "token" varchar(32) NOT NULL DEFAULT '',
    "encoding_aes_key_enc" varchar(500),
    "encoding_aes_key_mask" varchar(20),
    "enabled" boolean NOT NULL DEFAULT false,
    "greeting_text" varchar(500) NOT NULL DEFAULT '',
    "fallback_text" varchar(500) NOT NULL DEFAULT '',
    "handoff_text" varchar(500) NOT NULL DEFAULT '',
    "handoff_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "daily_answer_limit" integer NOT NULL DEFAULT 200,
    "last_tested_at" timestamptz(6),
    "last_test_status" varchar(10),
    "last_test_error" varchar(500),
    "last_test_latency_ms" integer,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_wechat_mp_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_wechat_mp_user" (
    "id" BIGSERIAL NOT NULL,
    "openid" varchar(64) NOT NULL,
    "unionid" varchar(64),
    "user_id" BIGINT,
    "nickname" varchar(100),
    "avatar_url" varchar(500),
    "is_subscribed" boolean NOT NULL DEFAULT true,
    "subscribed_at" timestamptz(6),
    "unsubscribed_at" timestamptz(6),
    "last_message_at" timestamptz(6),
    "message_count" integer NOT NULL DEFAULT 0,
    "is_manual_pending" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_wechat_mp_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_wechat_mp_message" (
    "id" BIGSERIAL NOT NULL,
    "channel_user_id" BIGINT NOT NULL,
    "wechat_msg_id" varchar(100) NOT NULL,
    "direction" varchar(10) NOT NULL,
    "msg_type" varchar(20) NOT NULL,
    "event" varchar(20),
    "content" TEXT NOT NULL,
    "reply_kind" varchar(20),
    "answer_status" varchar(20),
    "latency_ms" integer,
    "ai_usage_id" BIGINT,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_wechat_mp_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_wechat_mp_lead" (
    "id" BIGSERIAL NOT NULL,
    "channel_user_id" BIGINT NOT NULL,
    "message_id" BIGINT,
    "reason" varchar(200) NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'open',
    "note" TEXT,
    "handled_at" timestamptz(6),
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_wechat_mp_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_wechat_mp_keyword" (
    "id" BIGSERIAL NOT NULL,
    "keyword" varchar(50) NOT NULL,
    "post_id" BIGINT,
    "reply_text" TEXT,
    "is_enabled" boolean NOT NULL DEFAULT true,
    "hit_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_wechat_mp_keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_feishu_alert_config" (
    "id" integer NOT NULL DEFAULT 1,
    "app_id" varchar(64) NOT NULL DEFAULT '',
    "app_secret_enc" varchar(500),
    "app_secret_mask" varchar(20),
    "chat_id" varchar(100) NOT NULL DEFAULT '',
    "chat_name" varchar(100) NOT NULL DEFAULT '',
    "enabled" boolean NOT NULL DEFAULT false,
    "is_notify_handoff" boolean NOT NULL DEFAULT true,
    "is_notify_daily" boolean NOT NULL DEFAULT false,
    "daily_summary_hour" integer NOT NULL DEFAULT 9,
    "last_tested_at" timestamptz(6),
    "last_test_status" varchar(10),
    "last_test_error" varchar(500),
    "last_test_latency_ms" integer,
    "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_feishu_alert_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_channel_wechat_mp_user_openid" ON "channel_wechat_mp_user"("openid");

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_user_user_id" ON "channel_wechat_mp_user"("user_id");

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_user_last_message" ON "channel_wechat_mp_user"("last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_channel_wechat_mp_message_wechat_msg_id" ON "channel_wechat_mp_message"("wechat_msg_id");

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_message_user_created" ON "channel_wechat_mp_message"("channel_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_message_created" ON "channel_wechat_mp_message"("created_at");

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_message_ai_usage" ON "channel_wechat_mp_message"("ai_usage_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_channel_wechat_mp_lead_message_id" ON "channel_wechat_mp_lead"("message_id");

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_lead_status_created" ON "channel_wechat_mp_lead"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_lead_user" ON "channel_wechat_mp_lead"("channel_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_channel_wechat_mp_keyword_keyword" ON "channel_wechat_mp_keyword"("keyword");

-- CreateIndex
CREATE INDEX "idx_channel_wechat_mp_keyword_post" ON "channel_wechat_mp_keyword"("post_id");

-- AddForeignKey
ALTER TABLE "channel_wechat_mp_user" ADD CONSTRAINT "channel_wechat_mp_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_wechat_mp_message" ADD CONSTRAINT "channel_wechat_mp_message_channel_user_id_fkey" FOREIGN KEY ("channel_user_id") REFERENCES "channel_wechat_mp_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_wechat_mp_message" ADD CONSTRAINT "channel_wechat_mp_message_ai_usage_id_fkey" FOREIGN KEY ("ai_usage_id") REFERENCES "ai_usage_log"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_wechat_mp_lead" ADD CONSTRAINT "channel_wechat_mp_lead_channel_user_id_fkey" FOREIGN KEY ("channel_user_id") REFERENCES "channel_wechat_mp_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_wechat_mp_lead" ADD CONSTRAINT "channel_wechat_mp_lead_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "channel_wechat_mp_message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_wechat_mp_keyword" ADD CONSTRAINT "channel_wechat_mp_keyword_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
