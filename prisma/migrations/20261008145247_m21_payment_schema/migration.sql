-- AlterTable
ALTER TABLE "content_post" ADD COLUMN     "is_purchasable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchase_price" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "pay_order" (
    "id" BIGSERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "gateway" VARCHAR(24) NOT NULL,
    "gateway_transaction_id" VARCHAR(64),
    "gateway_open_order_id" VARCHAR(64),
    "paid_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "client_ip" VARCHAR(45),
    "operator_note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pay_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_order_item" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "post_id" BIGINT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pay_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_post_purchase" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "post_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "source" VARCHAR(16) NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(200),

    CONSTRAINT "content_post_purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_notify_log" (
    "id" BIGSERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "gateway_status" VARCHAR(8) NOT NULL,
    "sign_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_notify_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_gateway_config" (
    "id" BIGSERIAL NOT NULL,
    "gateway" VARCHAR(24) NOT NULL,
    "app_id" VARCHAR(64) NOT NULL,
    "app_secret" VARCHAR(128) NOT NULL,
    "api_base" VARCHAR(128) NOT NULL,
    "api_base_backup" VARCHAR(128),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pay_gateway_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_pay_order_order_no" ON "pay_order"("order_no");

-- CreateIndex
CREATE INDEX "idx_pay_order_user_status" ON "pay_order"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_pay_order_status_expires" ON "pay_order"("status", "expires_at");

-- CreateIndex
CREATE INDEX "idx_pay_order_item_post_id" ON "pay_order_item"("post_id");

-- CreateIndex
CREATE INDEX "idx_content_post_purchase_post_id" ON "content_post_purchase"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_post_purchase_user_post" ON "content_post_purchase"("user_id", "post_id");

-- CreateIndex
CREATE INDEX "idx_pay_notify_log_order_no" ON "pay_notify_log"("order_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pay_gateway_config_gateway" ON "pay_gateway_config"("gateway");

-- AddForeignKey
ALTER TABLE "pay_order_item" ADD CONSTRAINT "pay_order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "pay_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

