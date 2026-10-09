-- M22 批①(2026-10-09):用户 Token 钱包/流水 + 反馈系统 + 台账用户锚。
-- 经 prisma migrate diff --from-migrations 生成(checkpoint 表 drift,dev 库
-- 禁用 migrate dev,同 20261009160000_m21_geo_stats 惯例);纯增量无数据回填。
-- AlterTable
ALTER TABLE "ai_usage_log" ADD COLUMN     "user_id" BIGINT;

-- AlterTable
ALTER TABLE "user_account" ADD COLUMN     "assistant_visible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "user_token_wallet" (
    "user_id" BIGINT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "period_key" CHAR(7) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_token_wallet_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_token_ledger" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" VARCHAR(16) NOT NULL,
    "session_id" VARCHAR(40),
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_token_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "visitor_id" VARCHAR(36),
    "category" VARCHAR(20) NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "contact" VARCHAR(200),
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "admin_note" VARCHAR(500),
    "session_id" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_user_token_ledger_user_recent" ON "user_token_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_feedback_status_recent" ON "feedback"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_ai_usage_log_user_created" ON "ai_usage_log"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_token_wallet" ADD CONSTRAINT "user_token_wallet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_token_ledger" ADD CONSTRAINT "user_token_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

