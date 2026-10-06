/**
 * 三域统一检索单测(K1):prisma 打桩,钉死三域 where 口径(visible+AI 终态 /
 * PUBLISHED / display)、逐词 OR insensitive、候选 take 与组限量截断、空词项
 * 短路不查库、loadCitationBodies 只取 picks 大字段。
 */
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  tgFindMany: vi.fn(),
  tgCount: vi.fn(),
  postFindMany: vi.fn(),
  postCount: vi.fn(),
  repoFindMany: vi.fn(),
  repoCount: vi.fn(),
  postBodies: vi.fn(),
  repoBodies: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: {
    telegram: {
      findMany: hoisted.tgFindMany,
      count: hoisted.tgCount,
    },
    post: {
      findMany: hoisted.postFindMany,
      count: hoisted.postCount,
    },
    githubRepo: {
      findMany: hoisted.repoFindMany,
      count: hoisted.repoCount,
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
  isP2002: () => false,
}));

import { buildTermOr, loadCitationBodies, searchAll } from "./unified-search";

function reset(rows: {
  telegram?: unknown[];
  post?: unknown[];
  repo?: unknown[];
  totals?: [number, number, number];
}): void {
  hoisted.tgFindMany.mockResolvedValue(rows.telegram ?? []);
  hoisted.postFindMany.mockResolvedValue(rows.post ?? []);
  hoisted.repoFindMany.mockResolvedValue(rows.repo ?? []);
  const [t = 0, p = 0, r = 0] = rows.totals ?? [];
  hoisted.tgCount.mockResolvedValue(t);
  hoisted.postCount.mockResolvedValue(p);
  hoisted.repoCount.mockResolvedValue(r);
  hoisted.postBodies.mockResolvedValue([]);
  hoisted.repoBodies.mockResolvedValue([]);
}

describe("buildTermOr", () => {
  it("词项 × 字段展平 OR 数组(contains insensitive)", () => {
    expect(buildTermOr(["mcp"], ["title", "excerpt"])).toEqual([
      { title: { contains: "mcp", mode: "insensitive" } },
      { excerpt: { contains: "mcp", mode: "insensitive" } },
    ]);
  });

  it("空词项 → [](调用方短路,防御永假)", () => {
    expect(buildTermOr([], ["title"])).toEqual([]);
  });
});

describe("searchAll", () => {
  it("空词项短路:不触库返回空结果", async () => {
    reset({});
    const r = await searchAll("!!!");
    expect(r.total).toBe(0);
    expect(r.terms).toEqual([]);
    expect(hoisted.tgFindMany).not.toHaveBeenCalled();
  });

  it("三域 where 口径与逐词 OR(可见性/AI 终态/PUBLISHED/display)", async () => {
    reset({ totals: [3, 2, 1] });
    const r = await searchAll("MCP 实战");
    expect(hoisted.tgFindMany.mock.calls[0]![0]!.where).toMatchObject({
      status: "visible",
      aiStatus: { in: ["done", "missing_transcript"] },
    });
    expect(hoisted.postFindMany.mock.calls[0]![0]!.where).toMatchObject({
      status: "published",
      publishedAt: { not: null },
    });
    expect(hoisted.repoFindMany.mock.calls[0]![0]!.where).toMatchObject({ display: true });
    // 逐词 × 4 字段 = 8 个 OR 分支
    expect(hoisted.tgFindMany.mock.calls[0]![0]!.where.OR).toHaveLength(8);
    expect(r.total).toBe(6);
  });

  it("候选 take 上限与组展示限量(telegram 6 / post 4 / repo 4)", async () => {
    const tgRow = (i: number) => ({
      id: BigInt(i),
      title: `mcp ${i}`,
      summary: "",
      url: `https://example.com/${i}`,
      publishedAt: new Date(2026, 0, 1 + i),
      createdAt: new Date(2026, 0, 1 + i),
      mediaType: "text",
      videoPlatform: null,
      videoBlogger: null,
      videoCoverUrl: null,
      videoDuration: null,
      videoEngagement: null,
      aiTopic: null,
      aiSummary: null,
      aiKeywords: [],
      source: { name: "源", type: "rss" },
    });
    reset({
      telegram: Array.from({ length: 9 }, (_, i) => tgRow(i)),
      totals: [9, 0, 0],
    });
    const r = await searchAll("mcp");
    expect(hoisted.tgFindMany.mock.calls[0]![0]!.take).toBe(50);
    expect(r.groups.telegram.items).toHaveLength(6);
    expect(r.groups.telegram.total).toBe(9);
    // score 同分(单词全命中)按 dateIso desc:最新在前
    expect(r.groups.telegram.items[0]!.id).toBe("8");
  });

  it("JS 计分重排:title 权重高于新近度", async () => {
    reset({
      telegram: [
        {
          id: BigInt(1),
          title: "无关",
          summary: "mcp 出现在摘要",
          url: "https://e/1",
          publishedAt: new Date(2026, 5, 2),
          createdAt: new Date(2026, 5, 2),
          mediaType: "text",
          videoPlatform: null,
          videoBlogger: null,
          videoCoverUrl: null,
          videoDuration: null,
          videoEngagement: null,
          aiTopic: null,
          aiSummary: null,
          aiKeywords: [],
          source: { name: "s", type: "rss" },
        },
        {
          id: BigInt(2),
          title: "mcp 指南",
          summary: "其他",
          url: "https://e/2",
          publishedAt: new Date(2026, 5, 1),
          createdAt: new Date(2026, 5, 1),
          mediaType: "text",
          videoPlatform: null,
          videoBlogger: null,
          videoCoverUrl: null,
          videoDuration: null,
          videoEngagement: null,
          aiTopic: null,
          aiSummary: null,
          aiKeywords: [],
          source: { name: "s", type: "rss" },
        },
      ],
      totals: [2, 0, 0],
    });
    const r = await searchAll("mcp");
    expect(r.groups.telegram.items.map((h) => h.id)).toEqual(["2", "1"]);
  });
});

describe("loadCitationBodies", () => {
  it("按 picks 分域补取,首段优先回落 excerpt/description,截 300 字", async () => {
    reset({});
    // 引用补取与检索共用 findMany 桩(不同 where 形态,取调用参数断言)
    hoisted.postFindMany.mockResolvedValue([
      {
        id: BigInt(156),
        excerpt: "摘要兜底",
        contentMd: "---\ntitle: x\n---\n\n# 标题\n\n正文首段,值得引用的内容。\n\n第二段。",
      },
    ]);
    hoisted.repoFindMany.mockResolvedValue([
      { id: 7, description: "仓库描述", readmeMd: "# Repo\n\nreadme 首段 " + "长".repeat(400) },
    ]);
    const map = await loadCitationBodies([
      { domain: "post", id: "156" },
      { domain: "repo", id: "7" },
      { domain: "telegram", id: "9" },
    ] as never);
    expect(map.get("post:156")).toBe("正文首段,值得引用的内容。");
    const repo = map.get("repo:7")!;
    expect(repo.startsWith("readme 首段")).toBe(true);
    expect(repo.length).toBeLessThanOrEqual(300);
    expect(hoisted.postFindMany.mock.calls.at(-1)![0]!.where.id).toEqual({ in: [BigInt(156)] });
    expect(hoisted.repoFindMany.mock.calls.at(-1)![0]!.where.id).toEqual({ in: [7] });
  });

  it("空 picks 不查库", async () => {
    reset({});
    await loadCitationBodies([]);
    expect(hoisted.postFindMany).not.toHaveBeenCalled();
    expect(hoisted.repoFindMany).not.toHaveBeenCalled();
  });
});
