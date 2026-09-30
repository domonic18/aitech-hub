import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { revalidatePostPaths } from "./revalidate";

describe("revalidatePostPaths(保存时按需失效,arch/07-frontend §1)", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
  });

  it("覆盖详情/md/首页/列表/归档/sitemap 全部缓存面", () => {
    revalidatePostPaths("%e6%b5%8b%e8%af%95");
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/%e6%b5%8b%e8%af%95/");
    expect(paths).toContain("/%e6%b5%8b%e8%af%95.md");
    expect(paths).toContain("/");
    expect(paths).toContain("/articles/");
    expect(paths).toContain("/archive/");
    expect(paths).toContain("/sitemap.xml");
  });
});
