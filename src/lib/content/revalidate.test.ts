import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { revalidateCategoryPaths, revalidatePostPaths } from "./revalidate";

describe("revalidatePostPaths(保存时按需失效,arch/07-frontend §1)", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
  });

  it("覆盖详情/md/首页/列表/归档/sitemap 全部缓存面(id 锚定形态)", () => {
    revalidatePostPaths({ id: BigInt(156), slug: "agent-ceping" });
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/post/156-agent-ceping/");
    expect(paths).toContain("/post/156-agent-ceping.md");
    expect(paths).toContain("/");
    expect(paths).toContain("/articles/");
    expect(paths).toContain("/archive/");
    expect(paths).toContain("/sitemap.xml");
  });

  it("slug 为空 → bare-id 缓存面", () => {
    revalidatePostPaths({ id: BigInt(58), slug: null });
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/post/58/");
    expect(paths).toContain("/post/58.md");
  });
});

describe("revalidateCategoryPaths(分类写侧失效,2026-10-16 增删改查)", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
  });

  it("覆盖分类页/首页/sitemap;sitemap 用 layout 型打中 Metadata Route tag", () => {
    revalidateCategoryPaths("ai-agents");
    expect(revalidatePath).toHaveBeenCalledWith("/category/ai-agents/");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/sitemap.xml", "layout");
  });
});
