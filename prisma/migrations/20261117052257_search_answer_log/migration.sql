-- CreateTable
CREATE TABLE "search_answer_log" (
    "id" BIGSERIAL NOT NULL,
    "visitor_id" VARCHAR(36),
    "question" VARCHAR(120) NOT NULL,
    "answer" TEXT,
    "cites" JSONB,
    "model_key" VARCHAR(60) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "ai_usage_session_id" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_answer_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_search_answer_log_created_at" ON "search_answer_log"("created_at");
