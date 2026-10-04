-- CreateTable
CREATE TABLE "github_repo" (
    "id" SERIAL NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "stars" INTEGER NOT NULL DEFAULT 0,
    "forks" INTEGER NOT NULL DEFAULT 0,
    "language" VARCHAR(50),
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "html_url" VARCHAR(500) NOT NULL,
    "homepage" VARCHAR(500),
    "default_branch" VARCHAR(100) NOT NULL DEFAULT 'main',
    "readme_md" TEXT,
    "readme_sha" CHAR(40),
    "readme_fetched_at" TIMESTAMPTZ(6),
    "display" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sync_interval_min" INTEGER NOT NULL DEFAULT 60,
    "last_sync_at" TIMESTAMPTZ(6),
    "next_sync_at" TIMESTAMPTZ(6),
    "consecutive_fails" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'healthy',
    "remark" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repo_activity" (
    "id" BIGSERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "url" VARCHAR(500),
    "author" VARCHAR(100),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_repo_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_repo_post" (
    "repo_id" INTEGER NOT NULL,
    "post_id" BIGINT NOT NULL,

    CONSTRAINT "github_repo_post_pkey" PRIMARY KEY ("repo_id","post_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_github_repo_full_name" ON "github_repo"("full_name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_github_repo_slug" ON "github_repo"("slug");

-- CreateIndex
CREATE INDEX "idx_github_repo_due" ON "github_repo"("enabled", "next_sync_at");

-- CreateIndex
CREATE INDEX "idx_github_repo_activity_repo_occurred" ON "github_repo_activity"("repo_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_github_repo_activity_repo_kind_ext" ON "github_repo_activity"("repo_id", "kind", "external_id");

-- CreateIndex
CREATE INDEX "idx_github_repo_post_post" ON "github_repo_post"("post_id");

-- AddForeignKey
ALTER TABLE "github_repo_activity" ADD CONSTRAINT "github_repo_activity_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "github_repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_repo_post" ADD CONSTRAINT "github_repo_post_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "github_repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_repo_post" ADD CONSTRAINT "github_repo_post_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
