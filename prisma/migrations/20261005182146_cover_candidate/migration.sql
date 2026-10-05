-- CreateTable
CREATE TABLE "ai_cover_candidate" (
    "id" BIGSERIAL NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "post_id" BIGINT,
    "prompt" VARCHAR(1000) NOT NULL,
    "media_path" VARCHAR(500) NOT NULL,
    "model_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_cover_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ai_cover_candidate_token" ON "ai_cover_candidate"("token");

-- CreateIndex
CREATE INDEX "idx_ai_cover_candidate_post" ON "ai_cover_candidate"("post_id");
