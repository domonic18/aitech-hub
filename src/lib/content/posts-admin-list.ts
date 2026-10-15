/**
 * 文章管理列表(M5-a;技术债批⑤ 自 posts-admin 拆出):分页 + 四分段计数,
 * 草稿含、软删不可见。写侧(create/update/生命周期)仍在 posts-admin。
 */
import { prisma } from "@/lib/db";

import { POST_STATUS_DELETED } from "./post-schema";

export const ADMIN_PAGE_SIZE = 15;

/** 管理列表行投影(id 走 BigInt,页面直传 RSC;出 Handler/客户端前 toString)。
 * M17 批④:同步弹窗默认值需 coverPath/seoTitle/seoDescription/excerpt,
 * 行操作「同步公众号」需 channels 状态(pending 禁点/synced 提示覆盖)。 */
const ADMIN_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  viewsCount: true,
  wpPostId: true,
  contentMd: true,
  coverPath: true,
  seoTitle: true,
  seoDescription: true,
  excerpt: true,
  category: { select: { slug: true, name: true } },
  tags: { select: { tag: { select: { name: true } } } },
  channels: { select: { channel: true, status: true } },
} as const;

export type AdminPostRow = Awaited<ReturnType<typeof listPostsAdmin>>["items"][number];

export interface AdminListQuery {
  page: number;
  segment: "all" | "published" | "draft" | "unpublished";
  q?: string;
}

function segmentWhere(segment: AdminListQuery["segment"], q?: string) {
  const text = q
    ? {
        OR: [{ title: { contains: q } }, { slug: { contains: q } }],
      }
    : {};
  // 软删(deleted)任何分段都不可见;下架 = draft 且 publishedAt 非空
  const base = { status: { not: POST_STATUS_DELETED }, ...text };
  if (segment === "published") return { ...base, status: "published" };
  if (segment === "draft") return { ...base, status: "draft", publishedAt: null };
  if (segment === "unpublished") return { ...base, status: "draft", publishedAt: { not: null } };
  return base;
}

/** 管理列表(草稿含)+ 四分段计数;updatedAt 倒序(最近改动优先) */
export async function listPostsAdmin({ page, segment, q }: AdminListQuery) {
  const where = segmentWhere(segment, q);
  const countWhere = (seg: AdminListQuery["segment"]) => segmentWhere(seg, q);
  const [items, all, published, draft, unpublished] = await prisma.$transaction([
    prisma.post.findMany({
      where,
      select: ADMIN_LIST_SELECT,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
    prisma.post.count({ where: countWhere("all") }),
    prisma.post.count({ where: countWhere("published") }),
    prisma.post.count({ where: countWhere("draft") }),
    prisma.post.count({ where: countWhere("unpublished") }),
  ]);
  return { items, total: all, counts: { all, published, draft, unpublished }, page, segment };
}
