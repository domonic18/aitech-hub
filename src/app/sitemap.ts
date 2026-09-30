import type { MetadataRoute } from "next";

import { listAllPostsForSeo } from "@/lib/content/posts";
import { listCategories, listTagsWithCount } from "@/lib/content/taxonomy";
import { absoluteUrl } from "@/lib/seo/site";

/** sitemap(arch/07-frontend §3:全部 published 文章 + 分类 + 标签 + 静态页;lastModified 取 updated_at) */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, categories, tags] = await Promise.all([
    listAllPostsForSeo(),
    listCategories(),
    listTagsWithCount(),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    "",
    "/articles/",
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
    url: absoluteUrl(`/${p.slug}/`),
    lastModified: p.updatedAt,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticPages, ...categoryPages, ...tagPages, ...postPages];
}
