-- CreateTable
CREATE TABLE "content_post_comment" (
    "id" BIGSERIAL NOT NULL,
    "post_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "author_name" VARCHAR(100) NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'visible',
    "parent_id" BIGINT,
    "wp_comment_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "content_post_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_post_like" (
    "post_id" BIGINT NOT NULL,
    "identity_key" VARCHAR(42) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "content_post_comment_like" (
    "comment_id" BIGINT NOT NULL,
    "identity_key" VARCHAR(42) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_post_comment_wp_comment_id" ON "content_post_comment"("wp_comment_id");

-- CreateIndex
CREATE INDEX "idx_content_post_comment_post_visible" ON "content_post_comment"("post_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idx_content_post_comment_status_recent" ON "content_post_comment"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_post_like_post_identity" ON "content_post_like"("post_id", "identity_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_post_comment_like_comment_identity" ON "content_post_comment_like"("comment_id", "identity_key");

-- AddForeignKey
ALTER TABLE "content_post_comment" ADD CONSTRAINT "content_post_comment_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_like" ADD CONSTRAINT "content_post_like_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_comment_like" ADD CONSTRAINT "content_post_comment_like_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "content_post_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

