-- AlterTable
ALTER TABLE "ai_usage_log" ADD COLUMN     "session_id" VARCHAR(40);

-- CreateIndex
CREATE INDEX "idx_ai_usage_log_session" ON "ai_usage_log"("session_id");
