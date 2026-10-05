/**
 * 项目 slug/URL 纯函数单测(M11 批③):派生规则(. _ 归 -、charset 收敛、
 * 空名兜底、长度截断)、projectPath 构造尾斜杠、isProjectSlug 守卫同构性、
 * 占位唯一化候选策略。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  githubRepo: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
  },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

import { isProjectSlug, projectPath, PROJECTS_BASE } from "./project-path";
import { ensureUniqueProjectSlug, MAX_PROJECT_SLUG, projectSlugFromName } from "./project-slug";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.githubRepo.findMany.mockResolvedValue([]);
});

describe("projectSlugFromName(仓库名 → slug 基形)", () => {
  it("`.`/`_` 归分隔符,大写小写化,非法字符丢弃", () => {
    expect(projectSlugFromName("My_Repo")).toBe("my-repo");
    expect(projectSlugFromName("aitech-hub")).toBe("aitech-hub");
    expect(projectSlugFromName("demo.v2")).toBe("demo-v2");
    expect(projectSlugFromName("AI-Agent_Toolkit.pro")).toBe("ai-agent-toolkit-pro");
  });

  it("纯符号名 → repo 兜底;超长在 80 截断", () => {
    expect(projectSlugFromName("___")).toBe("repo");
    expect(projectSlugFromName("...")).toBe("repo");
    expect(projectSlugFromName("a".repeat(100))).toBe("a".repeat(MAX_PROJECT_SLUG));
  });
});

describe("projectPath / isProjectSlug(URL 构造唯一出口)", () => {
  it("尾斜杠红线;守卫与派生产物同构", () => {
    expect(PROJECTS_BASE).toBe("/projects");
    expect(projectPath("aitech-hub")).toBe("/projects/aitech-hub/");
    expect(projectPath("demo-v2")).toBe("/projects/demo-v2/");

    expect(isProjectSlug("aitech-hub")).toBe(true);
    expect(isProjectSlug("demo-v2")).toBe(true);
    expect(isProjectSlug("Demo")).toBe(false); // 大写非法(派生必小写)
    expect(isProjectSlug("-lead")).toBe(false);
    expect(isProjectSlug("trailing-")).toBe(false);
    expect(isProjectSlug("dou//ble")).toBe(false);
    expect(isProjectSlug("")).toBe(false);
  });

  it("派生产物必过守卫(抽样回归)", () => {
    for (const name of ["My_Repo", "demo.v2", "aitech-hub", "A", "x_y.z"]) {
      expect(isProjectSlug(projectSlugFromName(name))).toBe(true);
    }
  });
});

describe("ensureUniqueProjectSlug(登记时占位)", () => {
  it("基形空闲直接用", async () => {
    prismaMock.githubRepo.findMany.mockResolvedValue([]);
    await expect(ensureUniqueProjectSlug("My_Repo")).resolves.toBe("my-repo");
  });

  it("基形被占 → 取 -2 后缀", async () => {
    prismaMock.githubRepo.findMany.mockResolvedValue([{ slug: "my-repo" }]);
    await expect(ensureUniqueProjectSlug("My_Repo")).resolves.toBe("my-repo-2");
  });

  it("候选全占 → invalid 业务错误", async () => {
    prismaMock.githubRepo.findMany.mockResolvedValue(
      ["my-repo", ...Array.from({ length: 8 }, (_, i) => `my-repo-${i + 2}`)].map((slug) => ({
        slug,
      })),
    );
    await expect(ensureUniqueProjectSlug("My_Repo")).rejects.toMatchObject({ code: "invalid" });
  });
});
