-- AlterTable
ALTER TABLE "pay_gateway_config" ADD COLUMN     "notify_url" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "order_ttl_min" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "return_url" VARCHAR(500) NOT NULL DEFAULT '';

