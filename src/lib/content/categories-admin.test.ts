/** 分类管理 service 单测(prisma mock,无真库):slug 冲突/不存在/
 * 引用禁删/至少留一/软删迁移 + 更新剥离 slug(URL 红线)。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const revalidateCategoryPaths = vi.fn();
vi.mock("./revalidate", () => ({
  revalidateCategoryPaths: (...args: unknown[]) => revalidateCategoryPaths(...args),
}));

const categoryFindUnique = vi.fn();
const categoryFindMany = vi.fn();
const categoryCreate = vi.fn();
const categoryUpdate = vi.fn();
const categoryDelete = vi.fn();
const categoryCount = vi.fn();
const categoryFindFirst = vi.fn();
const postUpdateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    category: {
      findUnique: (...a: unknown[]) => categoryFindUnique(...a),
      findMany: (...a: unknown[]) => categoryFindMany(...a),
      create: (...a: unknown[]) => categoryCreate(...a),
      update: (...a: unknown[]) => categoryUpdate(...a),
      delete: (...a: unknown[]) => categoryDelete(...a),
      count: (...a: unknown[]) => categoryCount(...a),
      findFirst: (...a: unknown[]) => categoryFindFirst(...a),
    },
    post: { updateMany: (...a: unknown[]) => postUpdateMany(...a) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        category: { findFirst: categoryFindFirst, delete: categoryDelete },
        post: { updateMany: postUpdateMany },
      }),
  },
}));

import {
  CategoryAdminError,
  CategoryCreateSchema,
  CategoryUpdateSchema,
  createCategory,
  deleteCategory,
  updateCategory,
} from "./categories-admin";

const ROW = {
  id: BigInt(12),
  slug: "ai-agents",
  name: "AI 智能体",
  description: null,
  isOriginal: false,
  sortOrder: 10,
  _count: { posts: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CategoryCreateSchema/CategoryUpdateSchema", () => {
  it("slug 沿用 slugSchema URL 归一(百分号转义小写化,大小写保留)", () => {
    const r = CategoryCreateSchema.safeParse({ slug: "AI 智能体", name: " 智能体 " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.slug).toBe("AI%20%e6%99%ba%e8%83%bd%e4%bd%93");
      expect(r.data.name).toBe("智能体");
    }
  });

  it("更新 schema 无 slug 键(剥离透传的 slug,URL 红线)", () => {
    const r = CategoryUpdateSchema.safeParse({ slug: "hacked", name: "新名" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty("slug");
  });
});

describe("createCategory", () => {
  it("slug 已存在 → slug_conflict,不落库", async () => {
    categoryFindUnique.mockResolvedValue({ id: BigInt(1) });
    await expect(createCategory({ slug: "ai-agents", name: "x" })).rejects.toMatchObject({
      code: "slug_conflict",
    });
    expect(categoryCreate).not.toHaveBeenCalled();
  });

  it("空串描述归 null;sortOrder 缺省 0;落库后失效缓存面(route 先 safeParse 再进 service)", async () => {
    categoryFindUnique.mockResolvedValue(null);
    categoryCreate.mockResolvedValue({ ...ROW, _count: { posts: 0 } });
    const row = await createCategory(
      CategoryCreateSchema.parse({ slug: "ai-agents", name: "AI 智能体", description: "  " }),
    );
    expect(categoryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: "ai-agents",
        description: null,
        isOriginal: false,
        sortOrder: 0,
      }),
      select: expect.anything(),
    });
    expect(row.postCount).toBe(0);
    expect(revalidateCategoryPaths).toHaveBeenCalledWith("ai-agents");
  });
});

describe("updateCategory", () => {
  it("分类不存在 → not_found", async () => {
    categoryFindUnique.mockResolvedValue(null);
    await expect(updateCategory(BigInt(99), { name: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(categoryUpdate).not.toHaveBeenCalled();
  });

  it("部分更新:未传字段不进 data(描述空串归 null)", async () => {
    categoryFindUnique.mockResolvedValue({ slug: "ai-agents" });
    categoryUpdate.mockResolvedValue(ROW);
    await updateCategory(BigInt(12), CategoryUpdateSchema.parse({ name: "新名", description: "" }));
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(12) },
      data: { name: "新名", description: null },
      select: expect.anything(),
    });
    expect(revalidateCategoryPaths).toHaveBeenCalledWith("ai-agents");
  });

  it("isOriginal 透传更新(2026-10-20 原创标记);未传不进 data", async () => {
    categoryFindUnique.mockResolvedValue({ slug: "ai-agents" });
    categoryUpdate.mockResolvedValue(ROW);
    await updateCategory(BigInt(12), CategoryUpdateSchema.parse({ isOriginal: true }));
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(12) },
      data: { isOriginal: true },
      select: expect.anything(),
    });
  });
});

describe("deleteCategory", () => {
  it("有未删除文章引用 → in_use 报数,禁删", async () => {
    categoryFindUnique.mockResolvedValue({ slug: "ai-agents", _count: { posts: 5 } });
    await expect(deleteCategory(BigInt(12))).rejects.toMatchObject({
      code: "in_use",
      message: expect.stringContaining("5 篇"),
    });
    expect(categoryDelete).not.toHaveBeenCalled();
  });

  it("仅剩最后一个分类 → last_category", async () => {
    categoryFindUnique.mockResolvedValue({ slug: "ai-agents", _count: { posts: 0 } });
    categoryCount.mockResolvedValue(1);
    await expect(deleteCategory(BigInt(12))).rejects.toMatchObject({
      code: "last_category",
    });
  });

  it("软删残留引用事务内迁至剩余分类(sortOrder 最小者)后删除", async () => {
    categoryFindUnique.mockResolvedValue({ slug: "ai-agents", _count: { posts: 0 } });
    categoryCount.mockResolvedValue(4);
    categoryFindFirst.mockResolvedValue({ id: BigInt(7) });
    await deleteCategory(BigInt(12));
    expect(categoryFindFirst).toHaveBeenCalledWith({
      where: { id: { not: BigInt(12) } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect(postUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: BigInt(12) },
      data: { categoryId: BigInt(7) },
    });
    expect(categoryDelete).toHaveBeenCalledWith({ where: { id: BigInt(12) } });
    expect(revalidateCategoryPaths).toHaveBeenCalledWith("ai-agents");
  });

  it("事务内取不到兜底分类 → last_category(防御:count 与事务窗口竞态)", async () => {
    categoryFindUnique.mockResolvedValue({ slug: "ai-agents", _count: { posts: 0 } });
    categoryCount.mockResolvedValue(2);
    categoryFindFirst.mockResolvedValue(null);
    await expect(deleteCategory(BigInt(12))).rejects.toBeInstanceOf(CategoryAdminError);
    expect(categoryDelete).not.toHaveBeenCalled();
  });
});
