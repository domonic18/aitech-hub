/**
 * 文章读侧 service(RSC 页面与 SEO Route Handler 共用;arch/05-services §1:
 * 页面禁止裸 Prisma,一律经 service;复杂查询集中本目录)。
 * 写侧(保存钩子/revalidate 编排)随 M5 管理后台落地。
 */
import { prisma } from "@/lib/db";
import { postPathSegment } from "@/lib/content/post-path";
import { prerenderSafe } from "@/lib/prerender-safe";

/** 列表条目统一投影(卡片/sitemap/llms 共用;避免每处 select 漂移) */
const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverPath: true,
  viewsCount: true,
  isPinned: true,
  publishedAt: true,
  updatedAt: true,
  seoDescription: true,
  category: { select: { slug: true, name: true } },
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} as const;

export type PostListItem = Awaited<ReturnType<typeof listLatestPosts>>[number];

export const PUBLISHED = { status: "published", publishedAt: { not: null } } as const;
const ORDER = [{ publishedAt: "desc" }, { id: "desc" }] as const;

/** 详情:id 直取(2026-10 URL 终态,id 是唯一解析锚;slug 仅装饰);仅已发布 */
export async function getPostById(id: bigint) {
  return prisma.post.findFirst({
    where: { id, ...PUBLISHED },
    include: {
      category: { select: { slug: true, name: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
}

export async function listLatestPosts(limit: number) {
  return prerenderSafe("posts.latest", [], () =>
    prisma.post.findMany({
      where: PUBLISHED,
      select: LIST_SELECT,
      orderBy: [...ORDER],
      take: limit,
    }),
  );
}

export async function listPinnedPosts(limit: number) {
  return prerenderSafe("posts.pinned", [], () =>
    prisma.post.findMany({
      where: { ...PUBLISHED, isPinned: true },
      select: LIST_SELECT,
      orderBy: [...ORDER],
      take: limit,
    }),
  );
}

/** 已发布文章总数(首页 Hub whoami 状态行用;ISR 600s 内低频 count) */
export async function countPublishedPosts() {
  return prerenderSafe("posts.count", 0, () => prisma.post.count({ where: PUBLISHED }));
}

export interface ListPageParams {
  page: number;
  pageSize: number;
  categorySlug?: string;
  tagSlug?: string;
}

/** 分页列表(全部/分类/标签共用;tagSlug/categorySlug 由调用方先 normalizeSlug) */
export async function listPostsPage({ page, pageSize, categorySlug, tagSlug }: ListPageParams) {
  const where = {
    ...PUBLISHED,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(tagSlug ? { tags: { some: { tag: { slug: tagSlug } } } } : {}),
  };
  return prerenderSafe("posts.page", { items: [], total: 0, page, pageSize }, async () => {
    const [items, total] = await prisma.$transaction([
      prisma.post.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [...ORDER],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.post.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });
}

/** 搜索(requirement §3.1:标题/摘要 LIKE,一期不引入 ES;/search 动态 SSR 用) */
export async function searchPosts(q: string, page: number, pageSize: number) {
  const where = {
    ...PUBLISHED,
    OR: [
      { title: { contains: q, mode: "insensitive" as const } },
      { excerpt: { contains: q, mode: "insensitive" as const } },
    ],
  };
  const [items, total] = await prisma.$transaction([
    prisma.post.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [...ORDER],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.post.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export interface ArchivePost {
  id: bigint;
  slug: string | null;
  title: string;
  publishedAt: Date;
}

/** 归档:全量已发布的轻投影(103 篇量级一次取回,页面分组) */
export async function listArchivePosts(): Promise<ArchivePost[]> {
  return prerenderSafe("posts.archive", [], async () => {
    const rows = await prisma.post.findMany({
      where: PUBLISHED,
      select: { id: true, slug: true, title: true, publishedAt: true },
      orderBy: [{ publishedAt: "desc" }],
    });
    return rows.filter((r): r is ArchivePost & { publishedAt: Date } => r.publishedAt !== null);
  });
}

/**
 * /post/[slug] generateStaticParams 数据源:canonical 段(<id>-<slug> | <id>,纯 ASCII);
 * 构建期无库时降级为按需 ISR(arch/07-frontend §2 规则 5)。
 */
export async function listPostSegmentsForPrerender(): Promise<string[]> {
  try {
    const rows = await prisma.post.findMany({ where: PUBLISHED, select: { id: true, slug: true } });
    return rows.map((r) => postPathSegment(r.id, r.slug));
  } catch (e) {
    console.warn(JSON.stringify({ event: "posts.prerender.degraded", error: String(e) }));
    return [];
  }
}

/** sitemap/feed/llms 全量投影(轻字段;updatedAt 作 lastmod) */
export async function listAllPostsForSeo() {
  return prerenderSafe("posts.allForSeo", [], () =>
    prisma.post.findMany({
      where: PUBLISHED,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        seoDescription: true,
        contentMd: true,
        contentHtml: true,
        updatedAt: true,
        publishedAt: true,
      },
      orderBy: [...ORDER],
    }),
  );
}
