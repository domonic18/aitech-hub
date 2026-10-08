import { getSiteTitle } from "@/lib/config/site-config";
import { legacyRedirectOrNotFound } from "@/lib/content/legacy";
import { listPostsPage } from "@/lib/content/posts";
import { getCategoryBySlug, getTagBySlug } from "@/lib/content/taxonomy";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { normalizeSlug } from "@/lib/slug";
import PostListView from "./PostListView";

/** 分类/标签列表页共用逻辑(路由 /category/[slug]、/tag/[slug] 及其 /page/[page] 变体) */

export type TaxonomyKind = "category" | "tag";

export interface TaxonomyInfo {
  slug: string;
  name: string;
}

/** slug 解析(红线:必经 normalizeSlug)→ 查库;未命中走 legacy 兜底后 404 */
export async function resolveTaxonomy(
  kind: TaxonomyKind,
  rawSlug: string,
): Promise<TaxonomyInfo | null> {
  const slug = normalizeSlug(rawSlug);
  const found = kind === "category" ? await getCategoryBySlug(slug) : await getTagBySlug(slug);
  if (found) return found;
  await legacyRedirectOrNotFound([kind, rawSlug]); // 必抛(redirect/notFound)
  return null;
}

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

/** 列表正文(异步 server component,数据自取) */
export default async function TaxonomyListView({
  kind,
  info,
  page,
}: {
  kind: TaxonomyKind;
  info: TaxonomyInfo;
  page: number;
}): Promise<React.ReactElement> {
  const { items, total, pageSize } = await taxonomyPosts(kind, info.slug, page);
  return (
    <PostListView
      heading={kind === "category" ? `分类:${info.name}` : `标签:${info.name}`}
      items={items}
      total={total}
      page={page}
      pageSize={pageSize}
      basePath={`/${kind}/${info.slug}`}
    />
  );
}
