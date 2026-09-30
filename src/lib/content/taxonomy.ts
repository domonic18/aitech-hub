/** 分类/标签读侧 service(requirement §3.1:四分类沿用旧 slug;标签页承接旧外链) */
import { PUBLISHED } from "@/lib/content/posts";
import { prisma } from "@/lib/db";
import { normalizeSlug } from "@/lib/slug";
import { prerenderSafe } from "@/lib/prerender-safe";

/** 已发布文章计数:Category→Post 直连;Tag→Post 经 PostTag 关联表(where 口径不同) */
const publishedPostsCount = {
  _count: { select: { posts: { where: PUBLISHED } } },
};
const publishedPostsCountViaTag = {
  _count: { select: { posts: { where: { post: PUBLISHED } } } },
};

export async function listCategories() {
  return prerenderSafe("taxonomy.categories", [], () =>
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
  );
}

/** 分类 + 已发布文章计数(导航/列表页头用) */
export async function listCategoriesWithCount() {
  return prerenderSafe("taxonomy.categoriesWithCount", [], () =>
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      select: { slug: true, name: true, ...publishedPostsCount },
    }),
  );
}

export async function getCategoryBySlug(rawSlug: string) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;
  return prisma.category.findUnique({ where: { slug } });
}

/** 有已发布文章的标签(空标签不展示,arch/05-services 口径:仅保留文章关联的标签) */
export async function listTagsWithCount() {
  return prerenderSafe("taxonomy.tagsWithCount", [], async () => {
    const rows = await prisma.tag.findMany({
      select: { slug: true, name: true, ...publishedPostsCountViaTag },
      orderBy: { name: "asc" },
    });
    return rows.filter((t) => t._count.posts > 0);
  });
}

export async function getTagBySlug(rawSlug: string) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;
  return prisma.tag.findUnique({ where: { slug }, select: { slug: true, name: true } });
}

/** tag 页 generateStaticParams:DB 原始编码 slug;无库时降级按需 ISR */
export async function listTagSlugsForPrerender(): Promise<string[]> {
  try {
    const rows = await prisma.tag.findMany({ select: { slug: true } });
    return rows.map((r) => r.slug);
  } catch (e) {
    console.warn(JSON.stringify({ event: "tags.prerender.degraded", error: String(e) }));
    return [];
  }
}
