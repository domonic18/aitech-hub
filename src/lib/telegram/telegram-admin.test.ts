/**
 * 电报流治理列表单测(批⑧博主作品筛选):$transaction 逐个执行打桩,
 * 验 listWhere 组合——blogger 等值 video_blogger、隐含 video 覆盖 media、与 q 并存。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn<(ops: unknown[]) => Promise<unknown>>(async (ops) => Promise.all(ops)),
  telegram: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
    count: vi.fn<(args?: unknown) => Promise<unknown>>(async () => 0),
  },
  crawlSource: { findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []) },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { listTelegramAdmin } from "./telegram-admin";

/** 最近一次 telegram.findMany 的 where 参数 */
function lastWhere(): Record<string, unknown> {
  const call = prismaMock.telegram.findMany.mock.calls.at(-1) as [
    { where: Record<string, unknown> },
  ];
  return call![0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.telegram.findMany.mockResolvedValue([]);
  prismaMock.telegram.count.mockResolvedValue(0);
  prismaMock.crawlSource.findMany.mockResolvedValue([]);
});

describe("listTelegramAdmin 博主作品筛选(批⑧)", () => {
  it("blogger → mediaType=video + videoBlogger 等值", async () => {
    await listTelegramAdmin({ page: 1, segment: "all", blogger: "AI 前沿" });
    expect(lastWhere()).toEqual({ mediaType: "video", videoBlogger: "AI 前沿" });
  });

  it("blogger 覆盖 media=text(博主筛选隐含 video)", async () => {
    await listTelegramAdmin({ page: 1, segment: "all", media: "text", blogger: "AI 前沿" });
    expect(lastWhere()).toEqual({ mediaType: "video", videoBlogger: "AI 前沿" });
  });

  it("blogger 与 q 并存:OR 搜索 + videoBlogger 同 where", async () => {
    await listTelegramAdmin({ page: 1, segment: "all", q: "关键词", blogger: "AI 前沿" });
    expect(lastWhere()).toEqual({
      mediaType: "video",
      videoBlogger: "AI 前沿",
      OR: [
        { title: { contains: "关键词", mode: "insensitive" } },
        { summary: { contains: "关键词", mode: "insensitive" } },
      ],
    });
  });

  it("无 blogger 不出 videoBlogger 键(media 筛选行为不变)", async () => {
    await listTelegramAdmin({ page: 1, segment: "all", media: "video" });
    expect(lastWhere()).toEqual({ mediaType: "video" });
  });

  it("分段计数继承 blogger 筛选", async () => {
    await listTelegramAdmin({ page: 1, segment: "visible", blogger: "AI 前沿" });
    const countCalls = prismaMock.telegram.count.mock.calls as unknown as Array<
      [{ where: Record<string, unknown> }]
    >;
    const visibleCall = countCalls.find((c) => c[0].where.status === "visible")!;
    expect(visibleCall[0].where).toEqual({
      status: "visible",
      mediaType: "video",
      videoBlogger: "AI 前沿",
    });
  });
});
