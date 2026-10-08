-- AlterTable
ALTER TABLE "telegram" ADD COLUMN     "ai_points" JSONB,
ADD COLUMN     "ai_ran_at" TIMESTAMPTZ(6),
ADD COLUMN     "ai_status" VARCHAR(20),
ADD COLUMN     "ai_summary" VARCHAR(1000),
ADD COLUMN     "ai_topic" VARCHAR(50),
ADD COLUMN     "last_ai_error" VARCHAR(500);
