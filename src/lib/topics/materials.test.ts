/**
 * 素材读写单测(M42 批②,prisma 全 mock):可用口径(视频须已解读 / 文本须
 * 可见且有内容 / 文章未软删)、挂载幂等与并发回读、搜索分型映射与摘要截断、
 * 候选查询同时覆盖两类电报素材。
 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    topic: { findUnique: vi.fn() },
    topicItem: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    telegram: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    post: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

import { prisma } from "../db";
import { TopicError } from "./errors";
import { SEARCH_SUMMARY_MAX, searchMaterials } from "./material-search";
import {
  MOUNT_PAGE_SIZE,
  assertMaterialExists,
  listTelegramCandidates,
  mountItem,
  mountMaterial,
  unmountMaterial,
} from "./materials";

const m = {
  topicFind: vi.mocked(prisma.topic.findUnique),
  itemFindFirst: vi.mocked(prisma.topicItem.findFirst),
  itemCreate: vi.mocked(prisma.topicItem.create),
  itemDeleteMany: vi.mocked(prisma.topicItem.deleteMany),
  itemCount: vi.mocked(prisma.topicItem.count),
  tgFind: vi.mocked(prisma.telegram.findUnique),
  tgMany: vi.mocked(prisma.telegram.findMany),
  tgCount: vi.mocked(prisma.telegram.count),
  postFind: vi.mocked(prisma.post.findUnique),
  postMany: vi.mocked(prisma.post.findMany),
  postCount: vi.mocked(prisma.post.count),
};

function tgRow(over: Record<string, unknown> = {}) {
  return { mediaType: "video", status: "visible", aiStatus: "done", summary: "摘要", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertMaterialExists(可用口径)", () => {
  it("视频:解读完成可挂,未完成拒", async () => {
    m.tgFind.mockResolvedValueOnce(tgRow() as never);
    await expect(assertMaterialExists("telegram", BigInt(1))).resolves.toBeUndefined();
    m.tgFind.mockResolvedValueOnce(tgRow({ aiStatus: "pending" }) as never);
    await expect(assertMaterialExists("telegram", BigInt(2))).rejects.toMatchObject({
      code: "invalid_material",
    });
  });

  it("文本:可见且有内容可挂;隐藏/空摘要拒", async () => {
    m.tgFind.mockResolvedValueOnce(tgRow({ mediaType: "text" }) as never);
    await expect(assertMaterialExists("telegram", BigInt(3))).resolves.toBeUndefined();
    m.tgFind.mockResolvedValueOnce(tgRow({ mediaType: "text", status: "hidden" }) as never);
    await expect(assertMaterialExists("telegram", BigInt(4))).rejects.toThrow("隐藏");
    m.tgFind.mockResolvedValueOnce(tgRow({ mediaType: "text", summary: "  " }) as never);
    await expect(assertMaterialExists("telegram", BigInt(5))).rejects.toThrow("文字内容");
  });

  it("电报条目不存在 / 文章软删 → invalid_material", async () => {
    m.tgFind.mockResolvedValueOnce(null);
    await expect(assertMaterialExists("telegram", BigInt(9))).rejects.toThrow("不存在");
    m.postFind.mockResolvedValueOnce({ status: "deleted" } as never);
    await expect(assertMaterialExists("post", BigInt(9))).rejects.toThrow("已删除");
  });
});

describe("mountMaterial / mountItem(幂等)", () => {
  const row = { id: BigInt(11), topicId: BigInt(1), itemType: "post", itemId: BigInt(7) };

  it("已挂载 → created=false 且不再 create", async () => {
    m.topicFind.mockResolvedValue({ id: BigInt(1) } as never);
    m.postFind.mockResolvedValue({ status: "published" } as never);
    m.itemFindFirst.mockResolvedValue(row as never);
    const r = await mountMaterial(BigInt(1), "post", BigInt(7));
    expect(r).toEqual({ created: false, item: row });
    expect(m.itemCreate).not.toHaveBeenCalled();
  });

  it("未挂载 → 新建;note 空白归一为 null", async () => {
    m.topicFind.mockResolvedValue({ id: BigInt(1) } as never);
    m.postFind.mockResolvedValue({ status: "draft" } as never);
    m.itemFindFirst.mockResolvedValue(null);
    m.itemCreate.mockResolvedValue({ ...row, note: null } as never);
    const r = await mountMaterial(BigInt(1), "post", BigInt(7), "   ");
    expect(r.created).toBe(true);
    expect(m.itemCreate).toHaveBeenCalledWith({
      data: { topicId: BigInt(1), itemType: "post", itemId: BigInt(7), note: null },
    });
  });

  it("并发双挂 P2002 → 回读既有行按幂等返回", async () => {
    m.topicFind.mockResolvedValue({ id: BigInt(1) } as never);
    m.postFind.mockResolvedValue({ status: "published" } as never);
    m.itemFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row as never);
    m.itemCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const r = await mountMaterial(BigInt(1), "post", BigInt(7));
    expect(r).toEqual({ created: false, item: row });
  });

  it("治理台 mountItem 对重复挂载仍报 conflict", async () => {
    m.topicFind.mockResolvedValue({ id: BigInt(1) } as never);
    m.postFind.mockResolvedValue({ status: "published" } as never);
    m.itemFindFirst.mockResolvedValue(row as never);
    await expect(
      mountItem(BigInt(1), { itemType: "post", itemId: "7" } as never),
    ).rejects.toBeInstanceOf(TopicError);
  });

  it("专题不存在 → not_found", async () => {
    m.topicFind.mockResolvedValue(null);
    await expect(mountMaterial(BigInt(9), "post", BigInt(1))).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("unmountMaterial(幂等)", () => {
  it("删到行 → true;没删到 → false(不抛)", async () => {
    m.itemDeleteMany.mockResolvedValueOnce({ count: 1 } as never);
    await expect(unmountMaterial(BigInt(1), "telegram", BigInt(2))).resolves.toBe(true);
    m.itemDeleteMany.mockResolvedValueOnce({ count: 0 } as never);
    await expect(unmountMaterial(BigInt(1), "telegram", BigInt(2))).resolves.toBe(false);
  });
});

describe("searchMaterials", () => {
  it("电报文本/视频分型映射,摘要取 aiSummary 优先并截断", async () => {
    m.tgMany.mockResolvedValue([
      {
        id: BigInt(1),
        title: "视频标题",
        mediaType: "video",
        summary: "原文",
        aiSummary: "x".repeat(SEARCH_SUMMARY_MAX + 20),
        aiTopic: "端侧",
        videoBlogger: "UP",
        url: "https://b23.tv/a",
        publishedAt: new Date("2026-10-01T00:00:00Z"),
      },
      {
        id: BigInt(2),
        title: null,
        mediaType: "text",
        summary: "电报原文摘要",
        aiSummary: null,
        aiTopic: null,
        videoBlogger: null,
        url: "https://t.me/x",
        publishedAt: null,
      },
    ] as never);
    m.postMany.mockResolvedValue([] as never);
    const hits = await searchMaterials({ q: "端侧" });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      kind: "telegram",
      id: BigInt(1),
      mediaType: "video",
      meta: "视频 · UP",
    });
    expect(hits[0]?.summary?.endsWith("…")).toBe(true);
    expect(hits[0]?.summary?.length).toBe(SEARCH_SUMMARY_MAX + 1);
    expect(hits[1]).toMatchObject({ mediaType: "text", summary: "电报原文摘要", meta: "电报图文" });
  });

  it("文章命中带站内路径与状态人话;软删由 where 排除", async () => {
    m.tgMany.mockResolvedValue([] as never);
    m.postMany.mockResolvedValue([
      {
        id: BigInt(42),
        slug: "ai-agent",
        title: "旧文",
        status: "published",
        excerpt: "摘录",
        updatedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ] as never);
    const hits = await searchMaterials({ kind: "post", q: "agent" });
    expect(hits).toEqual([
      {
        kind: "post",
        id: BigInt(42),
        title: "旧文",
        mediaType: null,
        meta: "文章 · 已发布",
        summary: "摘录",
        url: "/post/42-ai-agent/",
        time: new Date("2026-09-01T00:00:00Z"),
      },
    ]);
    expect(m.tgMany).not.toHaveBeenCalled();
    expect(m.postMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "deleted" } }) }),
    );
  });

  it("limit 收敛到 1..20,默认 10", async () => {
    m.tgMany.mockResolvedValue([] as never);
    m.postMany.mockResolvedValue([] as never);
    await searchMaterials({ limit: 999 });
    expect(m.tgMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    vi.clearAllMocks();
    m.tgMany.mockResolvedValue([] as never);
    m.postMany.mockResolvedValue([] as never);
    await searchMaterials();
    expect(m.tgMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });
});

describe("listTelegramCandidates", () => {
  it("候选口径同时含『已解读视频』与『可见文本』,分页同 MOUNT_PAGE_SIZE", async () => {
    m.tgMany.mockResolvedValue([] as never);
    m.tgCount.mockResolvedValue(0 as never);
    await listTelegramCandidates(undefined, 2);
    const arg = m.tgMany.mock.calls[0]?.[0] as { where: unknown; skip: number; take: number };
    expect(arg.skip).toBe(MOUNT_PAGE_SIZE);
    expect(arg.take).toBe(MOUNT_PAGE_SIZE);
    expect(JSON.stringify(arg.where)).toContain('"aiStatus":"done"');
    expect(JSON.stringify(arg.where)).toContain('"mediaType":"text"');
    // 文本素材 aiRanAt 为 null:必须 nulls:last,否则 PG 的 DESC 缺省 NULLS FIRST
    // 会把整批文本顶到首页、新解读视频沉到末页(e2e 34 实证)
    const ordering = (arg as unknown as { orderBy: Array<Record<string, unknown>> }).orderBy;
    expect(ordering[0]).toEqual({ aiRanAt: { sort: "desc", nulls: "last" } });
  });
});
