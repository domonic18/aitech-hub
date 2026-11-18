-- CreateTable
CREATE TABLE "model_pricing_change" (
    "id" BIGSERIAL NOT NULL,
    "model_pricing_id" BIGINT NOT NULL,
    "vendor" VARCHAR(40) NOT NULL,
    "model_key" VARCHAR(60) NOT NULL,
    "old_input_price" DECIMAL(12,4),
    "old_output_price" DECIMAL(12,4),
    "new_input_price" DECIMAL(12,4),
    "new_output_price" DECIMAL(12,4),
    "old_currency" VARCHAR(8),
    "new_currency" VARCHAR(8),
    "old_price_unit" VARCHAR(20),
    "new_price_unit" VARCHAR(20),
    "change_kind" VARCHAR(20) NOT NULL,
    "source_key" VARCHAR(40),
    "source_url" VARCHAR(300),
    "changed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_pricing_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_model_pricing_change_pricing" ON "model_pricing_change"("model_pricing_id");

-- CreateIndex
CREATE INDEX "idx_model_pricing_change_time" ON "model_pricing_change"("changed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_model_pricing_change_pricing_time" ON "model_pricing_change"("model_pricing_id", "changed_at");

-- AddForeignKey
ALTER TABLE "model_pricing_change" ADD CONSTRAINT "model_pricing_change_model_pricing_id_fkey" FOREIGN KEY ("model_pricing_id") REFERENCES "model_pricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

