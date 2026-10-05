-- AlterTable
ALTER TABLE "ai_model" ADD COLUMN     "price_in" DOUBLE PRECISION,
ADD COLUMN     "price_out" DOUBLE PRECISION,
ADD COLUMN     "price_per_image" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "asr_config" ADD COLUMN     "price_per_hour" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ai_usage_log" (
    "id" BIGSERIAL NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "model_id" INTEGER,
    "model_key" VARCHAR(100) NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "audio_seconds" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ok',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ai_usage_log_created" ON "ai_usage_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_ai_usage_log_role_model" ON "ai_usage_log"("role", "model_id");
