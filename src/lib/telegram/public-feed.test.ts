/**
 * 首页带合并纯函数单测(批⑧保底槽位):最新视频不在混排前 N 则替换末位,
 * 在则原样;不破坏倒序不变量。M10 批②:offset 分页钳制(0..500)。
 * db 打桩(import 链含 prisma 客户端)。
 */
import { describe, expect, it, vi } from "vitest";

const findManyMock = vi.hoisted(() => vi.fn<(args?: unknown) => Promise<unknown[]>>());
vi.mock("../db", () => ({
  prisma: { telegram: { findMany: findManyMock } },
  isP2002: () => false,
}));

import { mergeBandItems, listPublicTelegram } from "./public-feed";
import { toVideoAi, type PublicTelegramItem } from "./feed-view";

function item(id: string, publishedAt: string): PublicTelegramItem {
  return {
    id,
    title: `标题 ${id}`,
    summary: "",
    url: `https://example.com/${id}`,
    publishedAt,
    sourceId: 1,
    sourceName: "渠道",
    mediaType: "text",
  };
}

function videoItem(id: string, publishedAt: string): PublicTelegramItem {
  return {
    ...item(id, publishedAt),
    mediaType: "video",
    video: {
      platform: "douyin",
      blogger: "博主",
      coverUrl: null,
      durationSeconds: 60,
      engagement: { play: null, like: null, comment: null },
      ai: null,
    },
  };
}

describe("mergeBandItems 视频保底槽位", () => {
  const mixed = Array.from({ length: 8 }, (_, i) => item(`t${i}`, `2026-10-04T0${i}:00:00+08:00`));

  it("最新视频已在混排前 N → 原样返回(同引用),游标消费全部", () => {
    const withVideo = [
      ...mixed.slice(0, 3),
      videoItem("v", mixed[3]!.publishedAt),
      ...mixed.slice(4),
    ];
    const out = mergeBandItems(withVideo, withVideo[3]!, 8);
    expect(out.items).toBe(withVideo);
    expect(out.nextOffset).toBe(8);
  });

  it("最新视频不在前 N → 替换末位,被替换项不占游标(后续页补达)", () => {
    const newest = videoItem("v", "2026-09-28T10:00:00+08:00");
    const out = mergeBandItems(mixed, newest, 8);
    expect(out.items).toHaveLength(8);
    expect(out.items.at(-1)).toBe(newest);
    expect(out.items.slice(0, 7)).toEqual(mixed.slice(0, 7));
    expect(out.nextOffset).toBe(7);
  });

  it("混排不足 N → 追加视频,游标消费混排全长", () => {
    const short = mixed.slice(0, 3);
    const newest = videoItem("v", "2026-09-28T10:00:00+08:00");
    const out = mergeBandItems(short, newest, 8);
    expect(out.items).toHaveLength(4);
    expect(out.items.at(-1)).toBe(newest);
    expect(out.nextOffset).toBe(3);
  });

  it("无视频条目 → 原样返回", () => {
    const out = mergeBandItems(mixed, null, 8);
    expect(out.items).toBe(mixed);
    expect(out.nextOffset).toBe(8);
  });

  it("混排为空 → 仅视频,游标 0", () => {
    const newest = videoItem("v", "2026-09-28T10:00:00+08:00");
    const out = mergeBandItems([], newest, 8);
    expect(out.items).toEqual([newest]);
    expect(out.nextOffset).toBe(0);
  });
});

describe("toVideoAi 解读投影(M9;M12 截 5 条容文字关键词)", () => {
  it("summary 非空才产出;points 白名单过滤并截 5 条;topic trim", () => {
    expect(
      toVideoAi(" 主题 ", "概括", [
        "要点一",
        42,
        null,
        "要点二",
        "要点三",
        "要点四",
        "要点五",
        "要点六",
      ]),
    ).toEqual({
      topic: "主题",
      summary: "概括",
      points: ["要点一", "要点二", "要点三", "要点四", "要点五"],
    });
  });

  it("summary 空/非串 → null(未解读,前台跟数据显隐);库内形状异常防御", () => {
    expect(toVideoAi("主题", null, [])).toBeNull();
    expect(toVideoAi("主题", "  ", ["x"])).toBeNull();
    expect(toVideoAi({ evil: 1 }, "概括", "not-array")).toEqual({
      topic: "",
      summary: "概括",
      points: [],
    });
  });
});

describe("listPublicTelegram offset 分页(M10 批②)", () => {
  it("offset 透传 skip;非法/负值回落 0;越界 clamp 500", async () => {
    findManyMock.mockResolvedValue([]);
    await listPublicTelegram({ limit: 12, offset: 24 });
    expect(findManyMock).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 24, take: 12 }));
    await listPublicTelegram({ limit: 12, offset: -5 });
    expect(findManyMock).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 }));
    await listPublicTelegram({ limit: 12, offset: 9999 });
    expect(findManyMock).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 500 }));
    await listPublicTelegram({ limit: 12 });
    expect(findManyMock).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 }));
  });
});

describe("文字行轻解读投影(M12 批③)", () => {
  it("ai_* 有值 → ai 投影(中心思想 + 关键词);未解读 → ai null 显式透出", async () => {
    const now = new Date("2026-10-05T10:00:00+08:00");
    findManyMock.mockResolvedValueOnce([
      {
        id: BigInt(7),
        title: "标题",
        summary: "摘要",
        url: "https://example.com/7",
        publishedAt: now,
        createdAt: now,
        mediaType: "text",
        videoPlatform: null,
        videoBlogger: null,
        videoCoverUrl: null,
        videoDuration: null,
        videoEngagement: null,
        aiTopic: null,
        aiSummary: "中心思想一句话",
        aiPoints: ["关键词一", "关键词二", "关键词三"],
        source: { id: 3, name: "渠道" },
      },
      {
        id: BigInt(8),
        title: "未解读",
        summary: "",
        url: "https://example.com/8",
        publishedAt: now,
        createdAt: now,
        mediaType: "text",
        videoPlatform: null,
        videoBlogger: null,
        videoCoverUrl: null,
        videoDuration: null,
        videoEngagement: null,
        aiTopic: null,
        aiSummary: null,
        aiPoints: null,
        source: { id: 3, name: "渠道" },
      },
    ]);
    const items = await listPublicTelegram({ limit: 10 });
    expect(items[0]).toMatchObject({
      mediaType: "text",
      ai: { topic: "", summary: "中心思想一句话", points: ["关键词一", "关键词二", "关键词三"] },
    });
    expect(items[1]).toMatchObject({ mediaType: "text", ai: null });
  });
});
