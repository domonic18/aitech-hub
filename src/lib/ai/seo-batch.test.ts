/**
 * 批量 SEO 补全 worker 单测(M16 问题8):prisma/suggestSeo 打桩,验证
 * 跳过已填(仅补空缺语义)、仅写空字段(单侧已有值不覆盖)、失败隔离
 * (单篇异常记 failedIds 继续不废整批)与进度上报快照。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeoBatchProgress } from "./seo-batch";

type PostRow = {
  id: bigint;
  title: string;
  contentMd: string | null;
  excerpt: string | null;
  /** category 是关系(findUnique select 取 slug) */
  category: { slug: string };
  seoTitle: string | null;
  seoDescription: string | null;
  tags: Array<{ tag: { name: string } }>;
};

const findUnique = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  prisma: { post: { findUnique, update } },
}));
// logger/queue 顶层 import env(启动期校验),单测进程无 env → 一并打桩
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../queue", () => ({
  getQueue: vi.fn(),
  QUEUE_SEO_BATCH: "seo-batch",
  SEO_JOB_BATCH: "batch",
}));

const resolveAiModel = vi.hoisted(() => vi.fn());
vi.mock("./resolver", () => ({ resolveAiModel }));
resolveAiModel.mockResolvedValue({ id: 1, modelId: "m" });

const suggestSeo = vi.hoisted(() => vi.fn());
vi.mock("./seo-suggest", () => ({ suggestSeo }));

import { seoBatchJob } from "./seo-batch";

function row(overrides: Partial<Omit<PostRow, "id">> & { id: number }): PostRow {
  const { id, ...rest } = overrides;
  return {
    title: `标题${id}`,
    contentMd: "正文",
    excerpt: null,
    category: { slug: "ai" },
    seoTitle: null,
    seoDescription: null,
    tags: [{ tag: { name: "测试" } }],
    ...rest,
    id: BigInt(id),
  };
}

describe("seoBatchJob(仅补空缺)", () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    suggestSeo.mockReset();
    suggestSeo.mockResolvedValue({ seoTitle: "生成的标题", seoDescription: "生成的描述" });
    update.mockResolvedValue({});
  });

  it("两字段均空:调 suggestSeo 并写回两字段", async () => {
    findUnique.mockResolvedValue(row({ id: 1 }));
    const p = await seoBatchJob({ token: "t", ids: ["1"] });
    expect(suggestSeo).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { seoTitle: "生成的标题", seoDescription: "生成的描述" },
    });
    expect(p).toEqual({ processed: 1, total: 1, skipped: 0, failedIds: [] });
  });

  it("两字段均已填:跳过不调 LLM 不落库", async () => {
    findUnique.mockResolvedValue(row({ id: 2, seoTitle: "有", seoDescription: "也有" }));
    const p = await seoBatchJob({ token: "t", ids: ["2"] });
    expect(suggestSeo).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(p.skipped).toBe(1);
  });

  it("单侧已有值:仅补空侧,已有侧不覆盖", async () => {
    findUnique.mockResolvedValue(row({ id: 3, seoTitle: "已有标题" }));
    await seoBatchJob({ token: "t", ids: ["3"] });
    expect(update).toHaveBeenCalledWith({
      where: { id: BigInt(3) },
      data: { seoDescription: "生成的描述" },
    });
  });

  it("单篇失败隔离:记 failedIds 继续,后续篇照常补全", async () => {
    findUnique
      .mockResolvedValueOnce(row({ id: 4 }))
      .mockResolvedValueOnce(row({ id: 5 }))
      .mockResolvedValueOnce(row({ id: 6 }));
    suggestSeo.mockRejectedValueOnce(new Error("LLM 超时"));
    const p = await seoBatchJob({ token: "t", ids: ["4", "5", "6"] });
    expect(update).toHaveBeenCalledTimes(2);
    expect(p).toEqual({
      processed: 3,
      total: 3,
      skipped: 0,
      failedIds: ["4"],
    });
  });

  it("不存在的 id 与非法 id 均记失败,不抛出", async () => {
    findUnique.mockResolvedValue(null);
    const p = await seoBatchJob({ token: "t", ids: ["99", "not-a-number"] });
    expect(p.failedIds).toEqual(["99", "not-a-number"]);
    expect(p.processed).toBe(2);
  });

  it("逐篇上报进度快照(failedIds 为副本)", async () => {
    findUnique
      .mockResolvedValueOnce(row({ id: 7 }))
      .mockResolvedValueOnce(row({ id: 8, seoTitle: "有", seoDescription: "填" }));
    suggestSeo.mockRejectedValueOnce(new Error("fail"));
    const snaps: SeoBatchProgress[] = [];
    await seoBatchJob({ token: "t", ids: ["7", "8"] }, async (p) => {
      snaps.push(p);
    });
    expect(snaps).toEqual([
      { processed: 1, total: 2, skipped: 0, failedIds: ["7"] },
      { processed: 2, total: 2, skipped: 1, failedIds: ["7"] },
    ]);
  });
});
