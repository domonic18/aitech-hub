/**
 * 文章管理写侧 + 管理列表 service(M5-a;arch/05-services §1/§2):
 * 事务只在 service 层;revalidatePath 在事务提交成功后编排(revalidate.ts 是唯一落点)。
 * 旧文保真红线:WP 迁移的 HTML 正文(contentHtml 且无 contentMd)不可经后台改写。
 */
import { prisma } from "@/lib/db";
import { extractMediaRefs, syncMediaRefs } from "@/lib/media/refs";
import { normalizeSlug } from "@/lib/slug";

import { revalidatePostPaths } from "./revalidate";
import { POST_STATUS_DELETED, type PostCreateInput, type PostUpdateInput } from "./post-schema";

export const ADMIN_PAGE_SIZE = 15;

/**
 * 路径/字符串 id → BigInt(管理 API 与编辑页共用,评审 W4 收口双轨):
 * 非纯数字或溢出返回 null,由调用方决定 404/400 语义。
 */
export function parsePostId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** 业务错误 → Handler 按码映射 HTTP 状态,不裸抛 */
export type PostAdminErrorCode =
  "not_found" | "slug_conflict" | "legacy_readonly" | "category_missing";

export class PostAdminError extends Error {
  constructor(
    public code: PostAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 管理列表行投影(id 走 BigInt,页面直传 RSC;出 Handler/客户端前 toString) */
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
  category: { select: { slug: true, name: true } },
  tags: { select: { tag: { select: { name: true } } } },
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

/** 编辑器取稿:草稿含;软删不可取 */
export async function getPostForAdmin(id: bigint) {
  const post = await prisma.post.findFirst({
    where: { id, status: { not: POST_STATUS_DELETED } },
    include: {
      category: { select: { slug: true, name: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
  return post;
}

/** 标签按名 upsert(Prototype admin-editor:tags 按名自动建),返回关联 id 集 */
async function upsertTags(
  tx: Pick<typeof prisma, "tag">,
  names: string[],
): Promise<Array<{ tagId: bigint }>> {
  const seen = new Set<string>();
  const links: Array<{ tagId: bigint }> = [];
  for (const name of names) {
    const slug = normalizeSlug(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const tag = await tx.tag.upsert({
      where: { slug },
      update: {},
      create: { slug, name },
    });
    links.push({ tagId: tag.id });
  }
  return links;
}

/** slug 派生:显式 slug 优先,否则标题归一化(中文标题 → percent-encoded) */
function deriveSlug(input: PostCreateInput): string {
  return normalizeSlug(input.slug ?? input.title);
}

/** 自动派生 slug 的冲突候选:-2…-9 后缀(用户显式指定的冲突不在此列,直接 409) */
const DERIVED_SUFFIX_MAX = 9;

export async function createPost(input: PostCreateInput): Promise<{ id: bigint; slug: string }> {
  const base = deriveSlug(input);
  if (!base) throw new PostAdminError("slug_conflict", "slug 归一化后为空,请在高级选项手动指定");
  const category = await prisma.category.findUnique({ where: { slug: input.categorySlug } });
  if (!category) {
    throw new PostAdminError("category_missing", `分类不存在:${input.categorySlug}`);
  }
  // 自动派生(标题撞题常见)依次尝试后缀;显式 slug 冲突语义不变(409,让作者改)
  const explicit = input.slug !== undefined;
  const candidates = explicit
    ? [base]
    : [base, ...Array.from({ length: DERIVED_SUFFIX_MAX - 1 }, (_, i) => `${base}-${i + 2}`)];
  let slug: string | null = null;
  for (const candidate of candidates) {
    const dup = await prisma.post.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!dup) {
      slug = candidate;
      break;
    }
  }
  if (slug === null) throw new PostAdminError("slug_conflict", `slug 已存在:${base}`);

  const post = await prisma.$transaction(async (tx) => {
    const tags = await upsertTags(tx, input.tags);
    const created = await tx.post.create({
      data: {
        slug,
        title: input.title,
        excerpt: input.excerpt ?? null,
        contentMd: input.contentMd,
        coverPath: input.coverPath || null,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        categoryId: category.id,
        status: "draft",
        ...(tags.length > 0 ? { tags: { create: tags } } : {}),
      },
    });
    // 媒体引用随写落库(arch/08-media §3.1,孤儿/断链清洗的地基)
    await syncMediaRefs(
      tx,
      created.id,
      extractMediaRefs({ contentMd: created.contentMd, coverPath: created.coverPath }),
    );
    return created;
  });
  return { id: post.id, slug: post.slug };
}

/**
 * 更新(草稿含)。旧文保真:WP 迁移的纯 HTML 正文拒绝改写;
 * 已发布文章更新后重放 revalidate(内容修正即刻生效)。
 */
export async function updatePost(id: bigint, input: PostUpdateInput): Promise<{ slug: string }> {
  const post = await prisma.post.findFirst({
    where: { id, status: { not: POST_STATUS_DELETED } },
  });
  if (!post) throw new PostAdminError("not_found", "文章不存在");
  if (!post.contentMd) {
    throw new PostAdminError(
      "legacy_readonly",
      "旧文保真:HTML 正文不可改写,请转 Markdown 重新发布",
    );
  }
  const category = await prisma.category.findUnique({ where: { slug: input.categorySlug } });
  if (!category) {
    throw new PostAdminError("category_missing", `分类不存在:${input.categorySlug}`);
  }

  await prisma.$transaction(async (tx) => {
    const tags = await upsertTags(tx, input.tags);
    await tx.post.update({
      where: { id },
      data: {
        title: input.title,
        excerpt: input.excerpt ?? null,
        contentMd: input.contentMd,
        coverPath: input.coverPath || null,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        categoryId: category.id,
        tags: { deleteMany: {}, ...(tags.length > 0 ? { create: tags } : {}) },
      },
    });
    // 引用先删后插,与正文/封面原子一致(编辑器封面工作流 M5-b 起真实写 cover_path)
    await syncMediaRefs(
      tx,
      id,
      extractMediaRefs({ contentMd: input.contentMd, coverPath: input.coverPath || null }),
    );
  });
  if (post.status === "published") revalidatePostPaths(post.slug);
  return { slug: post.slug };
}

async function loadMutable(id: bigint) {
  const post = await prisma.post.findFirst({
    where: { id, status: { not: POST_STATUS_DELETED } },
    select: { id: true, slug: true, status: true, publishedAt: true, contentMd: true },
  });
  if (!post) throw new PostAdminError("not_found", "文章不存在");
  return post;
}

/** 发布:置 published;首次发布落 publishedAt(已下架重发保留原发布时间) */
export async function publishPost(id: bigint): Promise<{ slug: string }> {
  const post = await loadMutable(id);
  const updated = await prisma.post.update({
    where: { id },
    data: {
      status: "published",
      publishedAt: post.publishedAt ?? new Date(),
    },
  });
  revalidatePostPaths(post.slug);
  return { slug: updated.slug };
}

/** 下架:回 draft 并保留 publishedAt(展示态「已下架」,可重新上架) */
export async function unpublishPost(id: bigint): Promise<{ slug: string }> {
  const post = await loadMutable(id);
  await prisma.post.update({ where: { id }, data: { status: "draft" } });
  revalidatePostPaths(post.slug);
  return { slug: post.slug };
}

/** 软删:置 deleted,前台与列表即刻不可见;原为已发布时重放 revalidate */
export async function softDeletePost(id: bigint): Promise<{ slug: string }> {
  const post = await loadMutable(id);
  await prisma.post.update({ where: { id }, data: { status: POST_STATUS_DELETED } });
  if (post.status === "published") revalidatePostPaths(post.slug);
  return { slug: post.slug };
}
