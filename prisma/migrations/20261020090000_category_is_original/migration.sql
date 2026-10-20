-- 分类原创标记(2026-10-20 验收反馈:首页「博主文章/推荐视频」分流):
-- 文章随分类继承,blog/report 回填 true,其余(推荐视频/资讯/推广)false
ALTER TABLE "content_category" ADD COLUMN "is_original" BOOLEAN NOT NULL DEFAULT false;

UPDATE "content_category" SET "is_original" = true WHERE "slug" IN ('blog', 'report');
