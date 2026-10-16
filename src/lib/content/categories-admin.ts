/**
 * 分类管理写侧 + 台账(种子四分类见 prisma/seed.ts;2026-10-16 验收反馈:
 * 后台增删改查)。红线:slug 承载公开 URL(/category/<slug>/,arch/07 §2),
 * 建后不可改——改名只动 name/description/sortOrder。删除守卫:①非软删文章
 * 引用禁删(报数量);②至少保留一个分类(导航/编辑器下拉不可为空);软删
 * 残留引用在事务内迁至剩余分类中 sortOrder 最小者,防悬挂 FK。缓存失效经
 * revalidate.ts 单点编排(arch/05-services §1)。
 */
import { z } from "zod";

import { prisma } from "@/lib/db";

import { POST_STATUS_DELETED, slugSchema } from "./post-schema";
import { revalidateCategoryPaths } from "./revalidate";

export type CategoryAdminErrorCode = "not_found" | "slug_conflict" | "in_use" | "last_category";

export class CategoryAdminError extends Error {
  constructor(
    public code: CategoryAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 台账行(id 串化供客户端直用;postCount 不含软删,与删除守卫同口径) */
export interface CategoryAdminRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  postCount: number;
}

const NOT_DELETED_COUNT = {
  _count: { select: { posts: { where: { status: { not: POST_STATUS_DELETED } } } } },
} as const;

const ROW_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  sortOrder: true,
  ...NOT_DELETED_COUNT,
} as const;

function toRow(r: {
  id: bigint;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  _count: { posts: number };
}): CategoryAdminRow {
  return {
    id: r.id.toString(),
    slug: r.slug,
    name: r.name,
    description: r.description,
    sortOrder: r.sortOrder,
    postCount: r._count.posts,
  };
}

export async function listCategoriesAdmin(): Promise<CategoryAdminRow[]> {
  const rows = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: ROW_SELECT,
  });
  return rows.map(toRow);
}

/** slug 沿用 post-schema 同款 slugSchema(URL 归一:百分号转义小写化,
 * 保留大小写/下划线——与 taxonomy 查库口径一致,见 slug.ts);空串描述归 null */
export const CategoryCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, "名称必填").max(100),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/** 更新无 slug:公开 URL 红线(建后不可改,见文件头) */
export const CategoryUpdateSchema = z.object({
  name: z.string().trim().min(1, "名称必填").max(100).optional(),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function createCategory(
  input: z.infer<typeof CategoryCreateSchema>,
): Promise<CategoryAdminRow> {
  const dup = await prisma.category.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (dup) throw new CategoryAdminError("slug_conflict", `分类 slug 已存在:${input.slug}`);
  const created = await prisma.category.create({
    data: {
      slug: input.slug,
      name: input.name,
      description: input.description ? input.description : null,
      sortOrder: input.sortOrder ?? 0,
    },
    select: ROW_SELECT,
  });
  revalidateCategoryPaths(created.slug);
  return toRow(created);
}

export async function updateCategory(
  id: bigint,
  input: z.infer<typeof CategoryUpdateSchema>,
): Promise<CategoryAdminRow> {
  const existing = await prisma.category.findUnique({ where: { id }, select: { slug: true } });
  if (!existing) throw new CategoryAdminError("not_found", "分类不存在");
  const updated = await prisma.category.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description ? input.description : null }
        : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
    select: ROW_SELECT,
  });
  revalidateCategoryPaths(updated.slug);
  return toRow(updated);
}

/** 删除:非软删引用禁删;软删残留引用迁至剩余分类(sortOrder 最小者);至少留一个 */
export async function deleteCategory(id: bigint): Promise<void> {
  const row = await prisma.category.findUnique({
    where: { id },
    select: { slug: true, ...NOT_DELETED_COUNT },
  });
  if (!row) throw new CategoryAdminError("not_found", "分类不存在");
  if (row._count.posts > 0) {
    throw new CategoryAdminError(
      "in_use",
      `${row._count.posts} 篇文章仍引用该分类,请先在文章编辑中移走`,
    );
  }
  const total = await prisma.category.count();
  if (total <= 1) throw new CategoryAdminError("last_category", "至少保留一个分类");
  await prisma.$transaction(async (tx) => {
    const fallback = await tx.category.findFirst({
      where: { id: { not: id } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!fallback) throw new CategoryAdminError("last_category", "至少保留一个分类");
    // 软删文不在后台列表可见,无从手动移走——事务内迁移兜底,防悬挂 FK
    await tx.post.updateMany({ where: { categoryId: id }, data: { categoryId: fallback.id } });
    await tx.category.delete({ where: { id } });
  });
  revalidateCategoryPaths(row.slug);
}
