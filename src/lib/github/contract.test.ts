import { describe, expect, it } from "vitest";

import { commitItemSchema, readmeSchema, releaseItemSchema, repoMetaSchema } from "./contract";

describe("repoMetaSchema(脏字段降级不炸整包)", () => {
  it("全字段合法时逐字保留", () => {
    const parsed = repoMetaSchema.parse({
      full_name: "domonic18/aitech-hub",
      description: "Next.js 全栈单体",
      stargazers_count: 12,
      forks_count: 3,
      language: "TypeScript",
      topics: ["nextjs", "ai"],
      html_url: "https://github.com/domonic18/aitech-hub",
      homepage: "https://17aitech.com",
      default_branch: "main",
      pushed_at: "2026-10-04T00:00:00Z",
    });
    expect(parsed.stargazers_count).toBe(12);
    expect(parsed.topics).toEqual(["nextjs", "ai"]);
  });

  it("缺省/脏数值字段回落默认,可空字段归 null", () => {
    const parsed = repoMetaSchema.parse({
      full_name: "domonic18/x",
      html_url: "https://github.com/domonic18/x",
      stargazers_count: "not-a-number",
      language: null,
      default_branch: null,
    });
    expect(parsed.stargazers_count).toBe(0);
    expect(parsed.forks_count).toBe(0);
    expect(parsed.language).toBeNull();
    expect(parsed.topics).toEqual([]);
    expect(parsed.default_branch).toBe("main");
  });

  it("full_name/html_url 缺失即拒(锚点字段不降级)", () => {
    expect(repoMetaSchema.safeParse({ html_url: "https://x" }).success).toBe(false);
    expect(repoMetaSchema.safeParse({ full_name: "o/r" }).success).toBe(false);
  });
});

describe("readmeSchema", () => {
  it("base64 内容 + sha 必有;size 脏值回落 0", () => {
    const parsed = readmeSchema.parse({ content: "SGVsbG8=", sha: "abc", size: null });
    expect(parsed.content).toBe("SGVsbG8=");
    expect(parsed.size).toBe(0);
    expect(readmeSchema.safeParse({ content: "x" }).success).toBe(false);
  });
});

describe("commitItemSchema / releaseItemSchema(单条级容错)", () => {
  it("commit:author 缺省可过;sha/message 缺失即拒", () => {
    const parsed = commitItemSchema.parse({
      sha: "a".repeat(40),
      html_url: "https://github.com/o/r/commit/x",
      commit: { message: "feat: initial" },
    });
    expect(parsed.commit.author).toBeUndefined();
    expect(commitItemSchema.safeParse({ sha: "s", html_url: "u", commit: {} }).success).toBe(false);
  });

  it("release:name 缺省可过,tag_name/id/html_url 必有", () => {
    const parsed = releaseItemSchema.parse({
      id: 7,
      tag_name: "v1.0.0",
      html_url: "https://github.com/o/r/releases/v1",
      name: null,
    });
    expect(parsed.draft).toBe(false);
    expect(parsed.name).toBeNull();
    expect(releaseItemSchema.safeParse({ id: 7, html_url: "u" }).success).toBe(false);
  });
});
