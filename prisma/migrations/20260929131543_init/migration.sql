-- CreateTable
CREATE TABLE "content_post" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "excerpt" TEXT,
    "content_html" TEXT,
    "content_md" TEXT,
    "cover_path" VARCHAR(500),
    "category_id" BIGINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "views_count" BIGINT NOT NULL DEFAULT 0,
    "seo_title" VARCHAR(255),
    "seo_description" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "wp_post_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_category" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_tag" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_post_tag" (
    "post_id" BIGINT NOT NULL,
    "tag_id" BIGINT NOT NULL,

    CONSTRAINT "content_post_tag_pkey" PRIMARY KEY ("post_id","tag_id")
);

-- CreateTable
CREATE TABLE "content_media" (
    "id" BIGSERIAL NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(20) NOT NULL DEFAULT 'image',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "size_bytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" INTEGER,
    "thumb_path" VARCHAR(500),
    "sha1" CHAR(40),
    "storage" VARCHAR(20) NOT NULL DEFAULT 'local',
    "wp_attachment_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_media_ref" (
    "media_path" VARCHAR(500) NOT NULL,
    "post_id" BIGINT NOT NULL,

    CONSTRAINT "content_media_ref_pkey" PRIMARY KEY ("media_path","post_id")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" BIGSERIAL NOT NULL,
    "phone" VARCHAR(20),
    "nickname" VARCHAR(100),
    "avatar_path" VARCHAR(500),
    "bio" VARCHAR(500),
    "role" VARCHAR(20) NOT NULL DEFAULT 'user',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "password_hash" VARCHAR(255),
    "wp_user_id" BIGINT,
    "legacy_username" VARCHAR(100),
    "legacy_phpass" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_pat" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stats_post_view_daily" (
    "post_id" BIGINT NOT NULL,
    "view_date" DATE NOT NULL,
    "count" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stats_post_view_daily_pkey" PRIMARY KEY ("post_id","view_date")
);

-- CreateTable
CREATE TABLE "stats_visit_daily" (
    "stat_date" DATE NOT NULL,
    "pv" BIGINT NOT NULL DEFAULT 0,
    "uv" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stats_visit_daily_pkey" PRIMARY KEY ("stat_date")
);

-- CreateTable
CREATE TABLE "stats_referrer_daily" (
    "stat_date" DATE NOT NULL,
    "source_class" VARCHAR(20) NOT NULL,
    "source_name" VARCHAR(50) NOT NULL,
    "pv" BIGINT NOT NULL DEFAULT 0,
    "uv" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stats_referrer_daily_pkey" PRIMARY KEY ("stat_date","source_class","source_name")
);

-- CreateTable
CREATE TABLE "stats_page_daily" (
    "stat_date" DATE NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "pv" BIGINT NOT NULL DEFAULT 0,
    "uv" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stats_page_daily_pkey" PRIMARY KEY ("stat_date","path")
);

-- CreateTable
CREATE TABLE "stats_client_daily" (
    "stat_date" DATE NOT NULL,
    "browser" VARCHAR(50) NOT NULL,
    "os" VARCHAR(50) NOT NULL,
    "device_type" VARCHAR(20) NOT NULL,
    "pv" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "stats_client_daily_pkey" PRIMARY KEY ("stat_date","browser","os","device_type")
);

-- CreateTable
CREATE TABLE "legacy_url_map" (
    "old_path" VARCHAR(500) NOT NULL,
    "target_url" VARCHAR(500),
    "http_status" SMALLINT NOT NULL DEFAULT 301,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_url_map_pkey" PRIMARY KEY ("old_path")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_post_slug" ON "content_post"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_post_wp_post_id" ON "content_post"("wp_post_id");

-- CreateIndex
CREATE INDEX "idx_content_post_status_published" ON "content_post"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "idx_content_post_category" ON "content_post"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_category_slug" ON "content_category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_tag_slug" ON "content_tag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "uq_content_media_path" ON "content_media"("path");

-- CreateIndex
CREATE INDEX "idx_content_media_kind_status" ON "content_media"("kind", "status");

-- CreateIndex
CREATE INDEX "idx_content_media_ref_post" ON "content_media_ref"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_account_phone" ON "user_account"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_account_wp_user_id" ON "user_account"("wp_user_id");

-- CreateIndex
CREATE INDEX "idx_user_account_status" ON "user_account"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_pat_token_hash" ON "user_pat"("token_hash");

-- CreateIndex
CREATE INDEX "idx_user_pat_user" ON "user_pat"("user_id");

-- CreateIndex
CREATE INDEX "idx_stats_page_daily_date_pv" ON "stats_page_daily"("stat_date", "pv" DESC);

-- AddForeignKey
ALTER TABLE "content_post" ADD CONSTRAINT "content_post_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "content_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_tag" ADD CONSTRAINT "content_post_tag_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_tag" ADD CONSTRAINT "content_post_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "content_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media_ref" ADD CONSTRAINT "content_media_ref_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_pat" ADD CONSTRAINT "user_pat_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stats_post_view_daily" ADD CONSTRAINT "stats_post_view_daily_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
