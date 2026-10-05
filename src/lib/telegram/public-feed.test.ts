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
import {
  countUnseen,
  feedChipTone,
  mergeFeedItems,
  toTextAi,
  toVideoAi,
  type PublicTelegramItem,
} from "./feed-view";

function item(id: string, publishedAt: string): PublicTelegramItem {
  return {
    id,
    title: `标题 ${id}`,
    summary: "",
    url: `https://example.com/${id}`,
    publishedAt,
    aiRanAt: publishedAt,
    sourceId: 1,
    sourceName: "渠道",
    sourceType: "rss",
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

describe("mergeFeedItems 轮询增量合并(M15 批③)", () => {
  const a = item("101", "2026-10-06T10:00:00Z");
  const b = item("102", "2026-10-06T09:00:00Z");
  const c = item("103", "2026-10-06T08:00:00Z");

  it("id 去重 + publishedAt desc 排序;fresh 与 prev 重叠不重复", () => {
    expect(mergeFeedItems([b, c], [a, b])).toEqual([a, b, c]);
  });

  it("同 publishedAt 时 id 数值降序 tiebreak(字典序对跨位数失真,BigInt 比对)", () => {
    const x = item("9", "2026-10-06T10:00:00Z");
    const y = item("100", "2026-10-06T10:00:00Z");
    expect(mergeFeedItems([], [x, y]).map((i) => i.id)).toEqual(["100", "9"]);
  });

  it("「刚解读但发布较早」行落中段,不错误置顶(与服务端 orderBy 同构)", () => {
    // 104 发布最早但 aiRanAt 最新(补扫上屏):重排后按 publishedAt 归位末尾
    const oldPub = item("104", "2026-10-05T08:00:00Z");
    expect(mergeFeedItems([a, b], [oldPub]).map((i) => i.id)).toEqual(["101", "102", "104"]);
  });

  it("prev 为空 → 排序后的 fresh;fresh 为空 → 原列表", () => {
    expect(mergeFeedItems([], [b, a])).toEqual([a, b]);
    expect(mergeFeedItems([a, b], [])).toEqual([a, b]);
  });
});

describe("countUnseen 未读锚计数(M15 批③)", () => {
  const items = [
    item("103", "2026-10-06T10:00:00Z"),
    item("102", "2026-10-06T09:00:00Z"),
    item("101", "2026-10-06T08:00:00Z"),
  ];

  it("前插 N 条 → 锚下标即未读数;锚在首位 → 0;锚 null → 0", () => {
    expect(countUnseen(items, "101")).toBe(2);
    expect(countUnseen(items, "103")).toBe(0);
    expect(countUnseen(items, null)).toBe(0);
  });

  it("锚不在列表(翻页挤出/异常)→ 0 防御;中段插入(锚下)不计未读", () => {
    expect(countUnseen(items, "999")).toBe(0);
    // 旧发布新解读行插在锚(103)之下:锚下标不变,未读数不变
    const mid = item("104", "2026-10-05T08:00:00Z");
    expect(countUnseen(mergeFeedItems(items, [mid]), "103")).toBe(0);
  });
});

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

describe("toVideoAi 解读投影(M9;M12 截 5 条;批⑥ keywords 独立透出)", () => {
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
      keywords: null,
    });
  });

  it("summary 空/非串 → null(未解读,前台跟数据显隐);库内形状异常防御", () => {
    expect(toVideoAi("主题", null, [])).toBeNull();
    expect(toVideoAi("主题", "  ", ["x"])).toBeNull();
    expect(toVideoAi({ evil: 1 }, "概括", "not-array")).toEqual({
      topic: "",
      summary: "概括",
      points: [],
      keywords: null,
    });
  });

  it("keywords 白名单过滤截 5 条;缺省(视频行)恒 null", () => {
    expect(toVideoAi("", "概括", ["要点"], ["a", 1, null, "b", "c", "d", "e", "f"])).toEqual({
      topic: "",
      summary: "概括",
      points: ["要点"],
      keywords: ["a", "b", "c", "d", "e"],
    });
  });
});

describe("toTextAi 文字投影(M12 批⑥:要点+关键词双列,旧契约存量对调)", () => {
  it("新契约:points=要点、keywords=关键词,原样透出", () => {
    expect(toTextAi(null, "中心思想", ["要点一", "要点二"], ["词一", "词二", "词三"])).toEqual({
      topic: "",
      summary: "中心思想",
      points: ["要点一", "要点二"],
      keywords: ["词一", "词二", "词三"],
    });
  });

  it("旧契约存量(ai_points=关键词、ai_keywords 空)→ 对调:关键词进 keywords,要点缺省", () => {
    expect(toTextAi(null, "中心思想", ["关键词一", "关键词二"], null)).toEqual({
      topic: "",
      summary: "中心思想",
      points: [],
      keywords: ["关键词一", "关键词二"],
    });
  });

  it("未解读 → null;仅 summary 无数组 → 空要点空 tag", () => {
    expect(toTextAi(null, null, null, null)).toBeNull();
    expect(toTextAi(null, "中心思想", null, null)).toEqual({
      topic: "",
      summary: "中心思想",
      points: [],
      keywords: [],
    });
  });
});

describe("listPublicTelegram 可见性门禁与增量锚(M15 批①)", () => {
  it("where 恒含 aiStatus 终态过滤(done/missing_transcript),pending/failed/null 不上屏", async () => {
    findManyMock.mockResolvedValue([]);
    await listPublicTelegram({ limit: 5 });
    expect(findManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "visible",
          aiStatus: { in: ["done", "missing_transcript"] },
        }),
      }),
    );
  });

  it("after 增量锚=aiRanAt(变可见时刻),不再按 publishedAt/createdAt OR 过滤", async () => {
    findManyMock.mockResolvedValue([]);
    const after = new Date("2026-10-06T04:00:00Z");
    await listPublicTelegram({ limit: 5, afterIso: after.toISOString() });
    const arg = findManyMock.mock.lastCall![0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({ aiRanAt: { gt: after } });
    expect(arg.where.OR).toBeUndefined();
  });

  it("映射:aiRanAt 透出;null(存量脏数据)兜底 publishedAt", async () => {
    const now = new Date("2026-10-06T10:00:00+08:00");
    findManyMock.mockResolvedValueOnce([
      {
        id: BigInt(11),
        title: "带解读时刻",
        summary: "",
        url: "https://example.com/11",
        publishedAt: now,
        createdAt: now,
        aiRanAt: new Date(now.getTime() + 90_000),
        mediaType: "text",
        videoPlatform: null,
        videoBlogger: null,
        videoCoverUrl: null,
        videoDuration: null,
        videoEngagement: null,
        aiTopic: null,
        aiSummary: "中心思想",
        aiPoints: null,
        aiKeywords: null,
        source: { id: 3, name: "渠道" },
      },
      {
        id: BigInt(12),
        title: "解读时刻缺失",
        summary: "",
        url: "https://example.com/12",
        publishedAt: now,
        createdAt: now,
        aiRanAt: null,
        mediaType: "text",
        videoPlatform: null,
        videoBlogger: null,
        videoCoverUrl: null,
        videoDuration: null,
        videoEngagement: null,
        aiTopic: null,
        aiSummary: "中心思想",
        aiPoints: null,
        aiKeywords: null,
        source: { id: 3, name: "渠道" },
      },
    ]);
    const items = await listPublicTelegram({ limit: 10 });
    expect(items[0]!.aiRanAt).toBe(new Date(now.getTime() + 90_000).toISOString());
    expect(items[1]!.aiRanAt).toBe(now.toISOString());
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

describe("文字行轻解读投影(M12 批③;批⑥ 新契约+旧契约对调)", () => {
  it("新契约行:要点/关键词双列投影;旧契约行(ai_keywords 空)对调;未解读 → ai null 显式透出", async () => {
    const now = new Date("2026-10-05T10:00:00+08:00");
    const base = {
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
      source: { id: 3, name: "渠道" },
    };
    findManyMock.mockResolvedValueOnce([
      {
        ...base,
        id: BigInt(7),
        aiSummary: "中心思想一句话",
        aiPoints: ["要点一", "要点二"],
        aiKeywords: ["词一", "词二", "词三"],
      },
      // 批⑥ 前 done 的存量:ai_points=关键词、ai_keywords 列未回填
      {
        ...base,
        id: BigInt(9),
        aiSummary: "旧契约中心思想",
        aiPoints: ["旧词一", "旧词二", "旧词三"],
        aiKeywords: null,
      },
      {
        ...base,
        id: BigInt(8),
        title: "未解读",
        summary: "",
        aiSummary: null,
        aiPoints: null,
        aiKeywords: null,
      },
    ]);
    const items = await listPublicTelegram({ limit: 10 });
    expect(items[0]).toMatchObject({
      mediaType: "text",
      ai: {
        topic: "",
        summary: "中心思想一句话",
        points: ["要点一", "要点二"],
        keywords: ["词一", "词二", "词三"],
      },
    });
    expect(items[1]).toMatchObject({
      mediaType: "text",
      ai: { summary: "旧契约中心思想", points: [], keywords: ["旧词一", "旧词二", "旧词三"] },
    });
    expect(items[2]).toMatchObject({ mediaType: "text", ai: null });
  });
});

describe("feedChipTone 渠道章配色(原型 .src-*/.pf-* 口径;2026-10-05 反馈)", () => {
  it("视频条按 platform 定色:抖音 amber / 小红书 red / B站 blue / 未知 neutral", () => {
    expect(feedChipTone("social-video", "douyin")).toBe("amber");
    expect(feedChipTone("social-video", "xhs")).toBe("red");
    expect(feedChipTone("social-video", "bilibili")).toBe("blue");
    expect(feedChipTone("social-video", "kuaishou")).toBe("neutral");
  });

  it("文字条按源类型定色:rss→accent / web·api→blue / sns→amber / 未知 neutral", () => {
    expect(feedChipTone("rss")).toBe("accent");
    expect(feedChipTone("web")).toBe("blue");
    expect(feedChipTone("api")).toBe("blue");
    expect(feedChipTone("sns")).toBe("amber");
    expect(feedChipTone("unknown")).toBe("neutral");
  });

  it("platform 优先于源类型;大小写不敏感;空 platform 走源类型", () => {
    expect(feedChipTone("rss", "douyin")).toBe("amber");
    expect(feedChipTone("rss", "DouYin")).toBe("amber");
    expect(feedChipTone("social-video", "")).toBe("amber");
    expect(feedChipTone("rss", null)).toBe("accent");
  });
});
