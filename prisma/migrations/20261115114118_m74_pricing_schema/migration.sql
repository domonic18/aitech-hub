-- AlterTable
ALTER TABLE "model_pricing" ADD COLUMN     "is_free" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "model_id" BIGINT,
ADD COLUMN     "provider_id" BIGINT;

-- CreateTable
CREATE TABLE "model_pricing_provider" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "region" VARCHAR(10) NOT NULL DEFAULT 'cn',
    "source_kind" VARCHAR(20) NOT NULL DEFAULT 'official',
    "homepage_url" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'enabled',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_pricing_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_pricing_model" (
    "id" BIGSERIAL NOT NULL,
    "model_key" VARCHAR(120) NOT NULL,
    "match_key" VARCHAR(120) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "family" VARCHAR(60),
    "modality" VARCHAR(30) NOT NULL DEFAULT 'text',
    "status" VARCHAR(10) NOT NULL DEFAULT 'enabled',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_pricing_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_pricing_tier" (
    "id" BIGSERIAL NOT NULL,
    "model_pricing_id" BIGINT NOT NULL,
    "tier_label" VARCHAR(60) NOT NULL,
    "input_price" DECIMAL(12,4),
    "output_price" DECIMAL(12,4),
    "cache_price" DECIMAL(12,4),
    "min_tokens" INTEGER,
    "max_tokens" INTEGER,
    "unit" VARCHAR(20) NOT NULL DEFAULT 'per_1m_tokens',
    "currency" VARCHAR(8) NOT NULL DEFAULT 'CNY',
    "data_as_of" TIMESTAMPTZ(6) NOT NULL,
    "source_url" VARCHAR(300) NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_pricing_tier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_model_pricing_provider_page" ON "model_pricing_provider"("status", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "uq_model_pricing_provider_key" ON "model_pricing_provider"("key");

-- CreateIndex
CREATE INDEX "idx_model_pricing_model_family" ON "model_pricing_model"("family");

-- CreateIndex
CREATE UNIQUE INDEX "uq_model_pricing_model_key" ON "model_pricing_model"("model_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_model_pricing_model_match_key" ON "model_pricing_model"("match_key");

-- CreateIndex
CREATE INDEX "idx_model_pricing_tier_pricing" ON "model_pricing_tier"("model_pricing_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_model_pricing_tier_pricing_label" ON "model_pricing_tier"("model_pricing_id", "tier_label");

-- CreateIndex
CREATE INDEX "idx_model_pricing_provider_id" ON "model_pricing"("provider_id");

-- CreateIndex
CREATE INDEX "idx_model_pricing_model_id" ON "model_pricing"("model_id");

-- CreateIndex
CREATE INDEX "idx_model_pricing_free" ON "model_pricing"("is_free");

-- AddForeignKey
ALTER TABLE "model_pricing" ADD CONSTRAINT "model_pricing_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_pricing_provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_pricing" ADD CONSTRAINT "model_pricing_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "model_pricing_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_pricing_tier" ADD CONSTRAINT "model_pricing_tier_model_pricing_id_fkey" FOREIGN KEY ("model_pricing_id") REFERENCES "model_pricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
