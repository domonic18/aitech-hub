/** 热榜 fetcher 单测(M34 批③):解析器锚 2026-10-18 真机探样本(golden,
 * 形态漂移即红);run 编排=失败隔离/入池聚合/refreshMeta 透传/源闸跳过
 * (prisma mock)。 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signalCreate = vi.fn();
const signalUpdateMany = vi.fn();
const hotSourceFindMany = vi.fn();
const hotSourceUpsert = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  prisma: {
    insightSignal: {
      create: (...a: unknown[]) => signalCreate(...a),
      updateMany: (...a: unknown[]) => signalUpdateMany(...a),
    },
    insightHotSource: {
      findMany: (...a: unknown[]) => hotSourceFindMany(...a),
      upsert: (...a: unknown[]) => hotSourceUpsert(...a),
    },
  },
}));

import { parseBaiduHotlist } from "./baidu";
import { parseBilibiliHotlist } from "./bilibili";
import { runHotlistFetch } from "./run";
import { parseZhihuHotlist } from "./zhihu";
import type { HotFetcher, HotItem } from "./types";
import { HotlistError } from "./types";

// ── 百度(真机探:data.cards[].content[].content[],isTop 置顶位剔除)──

describe("parseBaiduHotlist", () => {
  const golden = {
    success: "true",
    data: {
      cards: [
        {
          content: [
            {
              content: [
                {
                  word: "AI 编程",
                  index: 1,
                  url: "https://top.baidu.com/item?word=%E6%90%9C%E7%B4%A2",
                  isTop: false,
                  hotTag: "2",
                },
                { word: "Word2", index: 2, url: "u2" },
                { word: "运营置顶", url: "u0", isTop: true }, // 真机:置顶位只有 isTop/url/word,无 index
                { word: "  ", index: 3 },
              ],
            },
          ],
        },
      ],
    },
  };

  it("两层 content 摊平、剔 isTop 置顶与空词、rank 按剩余顺序 1 起", () => {
    const items = parseBaiduHotlist(golden);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ refId: "AI 编程", title: "AI 编程", rank: 1 });
    expect(items[1]).toMatchObject({ refId: "Word2", rank: 2, url: "u2" });
  });

  it("形态漂移抛 HotlistError(单源失败,不静默出空榜)", () => {
    expect(() => parseBaiduHotlist({ data: {} })).toThrow(HotlistError);
    expect(() => parseBaiduHotlist(null)).toThrow(HotlistError);
  });
});

// ── 知乎(detail_text 提热度;api→www 链接改写)──

describe("parseZhihuHotlist", () => {
  const golden = {
    data: [
      {
        target: {
          id: 661234567,
          title: "如何评价新模型发布?",
          url: "https://api.zhihu.com/questions/661234567",
        },
        detail_text: "543 万热度",
      },
      {
        target: {
          id: "661234568",
          title: "问题2",
          url: "https://api.zhihu.com/questions/661234568",
        },
        detail_text: "热度讨论中", // 无万位数字 → heat 缺省
      },
    ],
  };

  it("refId=target.id、rank 1 起、万热度折算、api 链接改前台", () => {
    const items = parseZhihuHotlist(golden);
    expect(items).toEqual([
      {
        refId: "661234567",
        title: "如何评价新模型发布?",
        rank: 1,
        url: "https://www.zhihu.com/question/661234567",
        heat: 5_430_000,
      },
      {
        refId: "661234568",
        title: "问题2",
        rank: 2,
        url: "https://www.zhihu.com/question/661234568",
        heat: undefined,
      },
    ]);
  });

  it("形态漂移抛 HotlistError", () => {
    expect(() => parseZhihuHotlist({ data: "nope" })).toThrow(HotlistError);
  });
});

// ── B站(Referer 必带;show_name 展示名回退 keyword)──

describe("parseBilibiliHotlist", () => {
  const golden = {
    code: 0,
    data: {
      trending: {
        list: [
          { keyword: "keyword1", show_name: "展示名1", heat_score: 4887326, icon: "x" },
          { keyword: "  ", show_name: "空白", heat_score: 1 },
          { keyword: "keyword2", heat_score: 100 },
        ],
      },
    },
  };

  it("refId=keyword、title 优先 show_name 回退、heat 透传、空词剔除", () => {
    const items = parseBilibiliHotlist(golden);
    expect(items).toEqual([
      { refId: "keyword1", title: "展示名1", rank: 1, heat: 4887326 },
      { refId: "keyword2", title: "keyword2", rank: 2, heat: 100 },
    ]);
  });

  it("形态漂移抛 HotlistError", () => {
    expect(() => parseBilibiliHotlist({ data: { trending: { list: "nope" } } })).toThrow(
      HotlistError,
    );
  });
});

// ── run 编排(合成 fetcher + prisma mock)──

function fakeFetcher(source: string, items?: HotItem[], boom?: Error): HotFetcher {
  return {
    source: source as HotFetcher["source"],
    async fetchItems() {
      if (boom !== undefined) throw boom;
      return items ?? [];
    },
  };
}

function item(refId: string, rank: number): HotItem {
  return { refId, title: `标题${refId}`, rank, heat: 1000 - rank, url: `https://x/${refId}` };
}

describe("runHotlistFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signalCreate.mockResolvedValue({ id: BigInt(1) });
    signalUpdateMany.mockResolvedValue({ count: 1 });
    // 源闸缺省:无停用行(缺行=启用)
    hotSourceFindMany.mockResolvedValue([]);
    hotSourceUpsert.mockResolvedValue({});
  });

  it("逐源逐条入池:meta 带 rank/heat/url/batch,成功源计数 ingested", async () => {
    const r = await runHotlistFetch([
      fakeFetcher("hot-baidu", [item("a", 1), item("b", 2)]),
      fakeFetcher("hot-zhihu", []),
    ]);
    expect(r.sources).toEqual([
      expect.objectContaining({ source: "hot-baidu", fetched: 2, ingested: 2, failed: false }),
      expect.objectContaining({ source: "hot-zhihu", fetched: 0, ingested: 0 }),
    ]);
    const first = signalCreate.mock.calls[0]?.[0] as { data: { meta: Record<string, unknown> } };
    expect(first.data.meta).toMatchObject({
      rank: 1,
      heat: 999,
      url: "https://x/a",
      batch: r.batch,
    });
  });

  it("单源失败隔离:失败源 failed 记数,后续源照跑", async () => {
    const r = await runHotlistFetch([
      fakeFetcher("hot-baidu", undefined, new Error("HTTP 403")),
      fakeFetcher("hot-zhihu", [item("z", 1)]),
    ]);
    expect(r.sources[0]).toMatchObject({ source: "hot-baidu", failed: true, fetched: 0 });
    expect(r.sources[1]).toMatchObject({ source: "hot-zhihu", ingested: 1 });
  });

  it("refreshMeta 透传:P2002 走 updateMany 计 refreshed(仍在榜续热)", async () => {
    signalCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" }),
    );
    const r = await runHotlistFetch([fakeFetcher("hot-bilibili", [item("k", 1)])]);
    expect(r.sources[0]).toMatchObject({ refreshed: 1, ingested: 0 });
    expect(signalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "hot-bilibili", refId: "k" },
      }),
    );
  });

  it("源闸:停用源整源跳过(fetcher 不调、不回写),启用源照常+逐源回写拉取态", async () => {
    hotSourceFindMany.mockResolvedValue([{ source: "hot-baidu" }]); // enabled:false 的行
    const baiduFetch = vi.fn();
    const r = await runHotlistFetch([
      { source: "hot-baidu", fetchItems: baiduFetch },
      fakeFetcher("hot-zhihu", [item("z", 1)]),
    ]);
    expect(baiduFetch).not.toHaveBeenCalled();
    expect(r.sources).toEqual([expect.objectContaining({ source: "hot-zhihu" })]);
    // 启用源回写成功态;停用源无回写
    expect(hotSourceUpsert).toHaveBeenCalledTimes(1);
    expect(hotSourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: "hot-zhihu" } }),
    );
  });

  it("拉取态回写:成功清零连败,失败 +1 并记末次错误", async () => {
    await runHotlistFetch([fakeFetcher("hot-baidu", undefined, new Error("HTTP 403"))]);
    expect(hotSourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "hot-baidu" },
        update: expect.objectContaining({
          consecutiveFails: { increment: 1 },
          lastError: "Error: HTTP 403",
        }),
      }),
    );
    hotSourceUpsert.mockClear();
    await runHotlistFetch([fakeFetcher("hot-baidu", [item("a", 1)])]);
    expect(hotSourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "hot-baidu" },
        update: expect.objectContaining({ consecutiveFails: 0, lastError: null }),
      }),
    );
  });
});
