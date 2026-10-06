-- CreateTable
CREATE TABLE "search_agent_session" (
    "id" VARCHAR(36) NOT NULL,
    "visitor_id" VARCHAR(36) NOT NULL,
    "title" VARCHAR(40),
    "tokens_total" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_agent_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_search_agent_session_visitor_recent" ON "search_agent_session"("visitor_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "idx_search_agent_session_last_message" ON "search_agent_session"("last_message_at");
