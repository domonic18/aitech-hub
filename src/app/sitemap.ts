import type { MetadataRoute } from "next";

import { listAllPostsForSeo } from "@/lib/content/posts";
import { postPath } from "@/lib/content/post-path";
import { listCategories, listTagsWithCount } from "@/lib/content/taxonomy";
import { listProjectsForSeo } from "@/lib/github/public";
import { projectPath } from "@/lib/github/project-path";
import { absoluteUrl } from "@/lib/seo/site";

/** sitemap(arch/07-frontend §3:全部 published 文章 + 分类 + 标签 + 项目 + 静态页;lastModified 取 updated_at) */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, categories, tags, projects] = await Promise.all([
    listAllPostsForSeo(),
    listCategories(),
    listTagsWithCount(),
    listProjectsForSeo(),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    "",
    "/articles/",
    "/projects/",
    "/archive/",
    "/about/",
    "/agreement/",
    "/privacy/",
  ].map((p) => ({ url: absoluteUrl(p), changeFrequency: "weekly", priority: p === "" ? 1 : 0.6 }));
  const categoryPages: MetadataRoute.Sitemap = categories.map((c) => ({
    url: absoluteUrl(`/category/${c.slug}/`),
    changeFrequency: "daily",
    priority: 0.7,
  }));
  const tagPages: MetadataRoute.Sitemap = tags.map((t) => ({
    url: absoluteUrl(`/tag/${t.slug}/`),
    changeFrequency: "weekly",
    priority: 0.5,
  }));
  const postPages: MetadataRoute.Sitemap = posts.map((p) => ({
    url: absoluteUrl(postPath(p.id, p.slug)),
    lastModified: p.updatedAt,
    changeFrequency: "monthly",
    priority: 0.8,
  }));
  // 项目详情 lastModified 跟 README/meta 同步跳写(无变化轮次不 bump,见 sync.ts)
  const projectPages: MetadataRoute.Sitemap = projects.map((p) => ({
    url: absoluteUrl(projectPath(p.slug)),
    lastModified: p.updatedAt,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  return [...staticPages, ...categoryPages, ...tagPages, ...projectPages, ...postPages];
}
