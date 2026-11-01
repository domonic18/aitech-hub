/**
 * 文章读侧 service(RSC 页面与 SEO Route Handler 共用;arch/05-services §1:
 * 页面禁止裸 Prisma,一律经 service;复杂查询集中本目录)。
 * 写侧(保存钩子/revalidate 编排)随 M5 管理后台落地。
 */
import { cache } from "react";

import { prisma } from "@/lib/db";
import { postPathSegment } from "@/lib/content/post-path";
import { logWarn } from "@/lib/logger";
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
  isPurchasable: true, // M21 补齐批:列表卡付费徽标
  publishedAt: true,
  updatedAt: true,
  seoDescription: true,
  category: { select: { slug: true, name: true } },
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} as const;

export type PostListItem = Awaited<ReturnType<typeof listLatestPosts>>[number];

export const PUBLISHED = { status: "published", publishedAt: { not: null } } as const;
const ORDER = [{ publishedAt: "desc" }, { id: "desc" }] as const;

/**
 * 列表交互计数(M23 延伸需求:列表卡显示评论数/点赞数)。量级 154 文 × ISR
 * 600s,两次索引 groupBy 现查零漂移,不做冗余计数列(arch/03 决策②:计数列
 * 待量级真起来再议)。评论只数 visible——治理隐藏即从公开计数消失,与详情页
 * 口径一致;点赞无状态全数。须在 prerenderSafe 回调内调用(构建期无库随宿主降级)。
 */
async function attachInteractionCounts<T extends { id: bigint }>(
  items: T[],
): Promise<(T & { commentCount: number; likeCount: number })[]> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const [comments, likes] = await Promise.all([
    prisma.postComment.groupBy({
      by: ["postId"],
      where: { postId: { in: ids }, status: "visible" },
      _count: { postId: true },
    }),
    prisma.postLike.groupBy({
      by: ["postId"],
      where: { postId: { in: ids } },
      _count: { postId: true },
    }),
  ]);
  const commentMap = new Map(comments.map((g) => [g.postId, g._count.postId]));
  const likeMap = new Map(likes.map((g) => [g.postId, g._count.postId]));
  return items.map((item) => ({
    ...item,
    commentCount: commentMap.get(item.id) ?? 0,
    likeCount: likeMap.get(item.id) ?? 0,
  }));
}

/** 详情:id 直取(2026-10 URL 终态,id 是唯一解析锚;slug 仅装饰);仅已发布。
 * cache() 同请求去重:generateMetadata 与页面各调一次不再双查含双份正文(M48 批B);
 * 请求外(单测/路由脚本)行为同原函数 */
export const getPostById = cache(async (id: bigint) => {
  return prisma.post.findFirst({
    where: { id, ...PUBLISHED },
    include: {
      category: { select: { slug: true, name: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
});

/**
 * 最新文章(首页右栏;2026-10-20 验收反馈问题二:按分类原创标记分流——
 * original=true「博主文章」rail / false「推荐视频」rail,缺省不过滤)
 */
export async function listLatestPosts(limit: number, opts: { original?: boolean } = {}) {
  return prerenderSafe("posts.latest", [], async () => {
    const items = await prisma.post.findMany({
      where: {
        ...PUBLISHED,
        ...(opts.original !== undefined ? { category: { isOriginal: opts.original } } : {}),
      },
      select: LIST_SELECT,
      orderBy: [...ORDER],
      take: limit,
    });
    return attachInteractionCounts(items);
  });
}

/** 上一篇/下一篇轻投影(不带正文/分类/计数) */
const ADJACENT_SELECT = { id: true, slug: true, title: true, publishedAt: true } as const;

export type AdjacentPost = {
  id: bigint;
  slug: string | null;
  title: string;
  publishedAt: Date | null;
};

/**
 * 上一篇/下一篇(2026-11-01 文章阅读页):沿用列表同一排序键
 * (published_at desc, id desc) 逐位比较,因此与「最近文章」顺序严丝合缝。
 * getPostById 只取已发布文,这里的 current 必然已发布;两跳都限定 PUBLISHED,
 * 草稿/下架文不会出现在翻页链上。
 * 语义同 WP previous_post_link / next_post_link:prev = 更早发布,next = 更新发布。
 */
export async function getAdjacentPosts(current: {
  id: bigint;
  publishedAt: Date | null;
}): Promise<{ prev: AdjacentPost | null; next: AdjacentPost | null }> {
  return prerenderSafe("posts.adjacent", { prev: null, next: null }, async () => {
    const at = current.publishedAt;
    if (!at) return { prev: null, next: null };
    const [prev, next] = await Promise.all([
      prisma.post.findFirst({
        where: {
          ...PUBLISHED,
          OR: [{ publishedAt: { lt: at } }, { publishedAt: at, id: { lt: current.id } }],
        },
        select: ADJACENT_SELECT,
        orderBy: [...ORDER],
      }),
      prisma.post.findFirst({
        where: {
          ...PUBLISHED,
          OR: [{ publishedAt: { gt: at } }, { publishedAt: at, id: { gt: current.id } }],
        },
        select: ADJACENT_SELECT,
        orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return { prev, next };
  });
}

export async function listPinnedPosts(limit: number) {
  return prerenderSafe("posts.pinned", [], async () => {
    const items = await prisma.post.findMany({
      where: { ...PUBLISHED, isPinned: true },
      select: LIST_SELECT,
      orderBy: [...ORDER],
      take: limit,
    });
    return attachInteractionCounts(items);
  });
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
  /** 仅原创分类(/articles 页自称「全部原创文章」;分类/标签页不过滤) */
  originalOnly?: boolean;
}

/** 列表 where 单点构造(分页/head/计数共用同一口径,防三处漂移) */
function buildListWhere({
  categorySlug,
  tagSlug,
  originalOnly,
}: Omit<ListPageParams, "page" | "pageSize">) {
  return {
    ...PUBLISHED,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
    ...(tagSlug ? { tags: { some: { tag: { slug: tagSlug } } } } : {}),
    ...(originalOnly ? { category: { isOriginal: true } } : {}),
  };
}

/** 分页列表(全部/分类/标签共用;tagSlug/categorySlug 由调用方先 normalizeSlug) */
export async function listPostsPage({
  page,
  pageSize,
  categorySlug,
  tagSlug,
  originalOnly,
}: ListPageParams) {
  const where = buildListWhere({ categorySlug, tagSlug, originalOnly });
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
    return { items: await attachInteractionCounts(items), total, page, pageSize };
  });
}

/**
 * 合并流用:取时间序前 limit 条(不分页)。与 listPostsPage 同 where 口径;
 * 调用方先用 countPostsForList 定上限,再按需取头部,避免深页一次拉全表。
 */
export async function listPostsHead({
  limit,
  originalOnly,
}: {
  limit: number;
  originalOnly?: boolean;
}) {
  return prerenderSafe("posts.head", [], async () => {
    const items = await prisma.post.findMany({
      where: buildListWhere({ originalOnly }),
      select: LIST_SELECT,
      orderBy: [...ORDER],
      take: limit,
    });
    return attachInteractionCounts(items);
  });
}

/** 合并流用:已发布文章总数(与列表 where 同口径) */
export async function countPostsForList({ originalOnly }: { originalOnly?: boolean } = {}) {
  return prerenderSafe("posts.countForList", 0, () =>
    prisma.post.count({ where: buildListWhere({ originalOnly }) }),
  );
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
    logWarn("posts.prerender.degraded", { error: e });
    return [];
  }
}

/** sitemap 索引轻投影(M48 批B):仅 id/slug/updatedAt——正文大列属 feed/llms,
 * sitemap 每小时全量再生不该背着数十 KB/篇 的 body 白拉 */
export async function listPostSeoIndex() {
  return prerenderSafe("posts.seoIndex", [], () =>
    prisma.post.findMany({
      where: PUBLISHED,
      select: { id: true, slug: true, updatedAt: true },
      orderBy: [...ORDER],
    }),
  );
}

/** sitemap/feed/llms 全量投影(轻字段;updatedAt 作 lastmod;门禁字段供 GEO 面截断;
 * take 缺省=全量,sitemap/llms 不传,feed 传 RSS_FEED_SIZE 档「最新 20 篇」) */
export async function listAllPostsForSeo(take?: number) {
  return prerenderSafe("posts.allForSeo", [], () =>
    prisma.post.findMany({
      where: PUBLISHED,
      ...(take !== undefined ? { take } : {}),
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        seoDescription: true,
        contentMd: true,
        contentHtml: true,
        isPurchasable: true,
        isLoginRequired: true,
        updatedAt: true,
        publishedAt: true,
      },
      orderBy: [...ORDER],
    }),
  );
}
