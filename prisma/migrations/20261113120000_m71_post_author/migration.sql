-- 文章归属作者(M71,K3 复活):外部 agent 产出恒落草稿,后台需能回答「这篇是谁写的」。
-- 列可空:154 篇迁移旧文与存量稿无归属;外部通道取其 PAT 持有人 user_account.id。
-- 归属可空 + 父行删除后子行留档 → FK ON DELETE SET NULL(standard/03-db-naming §4.3)。
ALTER TABLE "content_post" ADD COLUMN "author_id" BIGINT;

-- FK 列必须自建索引(PG 不为非主键 FK 自动建索引,standard/03-db-naming §4.1)
CREATE INDEX "idx_content_post_author" ON "content_post"("author_id");

ALTER TABLE "content_post"
  ADD CONSTRAINT "content_post_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "user_account"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
