-- AlterTable
ALTER TABLE "model_pricing" ADD COLUMN     "price_unit" VARCHAR(20) NOT NULL DEFAULT 'per_1m_tokens';
