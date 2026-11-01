/**
 * 分类/标签列表页的取数与 metadata(路由 /category/[slug]、/tag/[slug] 及其
 * /page/[page] 变体共用)。与渲染组件分居:页面组件不得从组件目录导出查库函数
 * (2026-11-01 结构收口,组件侧见 components/site/TaxonomyListView.tsx)。
 */
import { cache } from "react";

import { getSiteTitle } from "@/lib/config/site-config";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { legacyRedirectOrNotFound } from "@/lib/content/legacy";
import { listPostsPage } from "@/lib/content/posts";
import { normalizeSlug } from "@/lib/slug";
import { getCategoryBySlug, getTagBySlug } from "./taxonomy";

export type TaxonomyKind = "category" | "tag";

export interface TaxonomyInfo {
  slug: string;
  name: string;
}

/** slug 解析(红线:必经 normalizeSlug)→ 查库;未命中走 legacy 兜底后 404。
 * cache() 同请求去重:generateMetadata 与页面各调一次不再双解析(M48 批B) */
export const resolveTaxonomy = cache(async function resolveTaxonomy(
  kind: TaxonomyKind,
  rawSlug: string,
): Promise<TaxonomyInfo | null> {
  const slug = normalizeSlug(rawSlug);
  const found = kind === "category" ? await getCategoryBySlug(slug) : await getTagBySlug(slug);
  if (found) return found;
  await legacyRedirectOrNotFound([kind, rawSlug]); // 必抛(redirect/notFound)
  return null;
});

export async function taxonomyPosts(kind: TaxonomyKind, slug: string, page: number) {
  return listPostsPage({
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    ...(kind === "category" ? { categorySlug: slug } : { tagSlug: slug }),
  });
}

export async function taxonomyMetadata(kind: TaxonomyKind, info: TaxonomyInfo, page: number) {
  const base = `/${kind}/${info.slug}/`;
  const title = kind === "category" ? `${info.name}分类文章` : `「${info.name}」标签文章`;
  const siteTitle = await getSiteTitle();
  return {
    title: page > 1 ? `${title} 第 ${page} 页` : title,
    description: `${title}——${siteTitle}原创内容。`,
    alternates: { canonical: page > 1 ? `${base}page/${page}/` : base },
  };
}
