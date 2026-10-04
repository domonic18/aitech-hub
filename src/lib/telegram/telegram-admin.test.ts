/**
 * 电报流治理单测:批⑧博主作品筛选(listWhere 组合)+ M9 手动解读触发
 * (not_found/not_video/no_link 前置、secUid 反查、遗留 job 清理、pending 重置与回滚)
 * + M10 批⑤解读态筛选(aiFilterWhere 口径与 listWhere 透传)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn<(ops: unknown[]) => Promise<unknown>>(async (ops) => Promise.all(ops)),
  telegram: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
    count: vi.fn<(args?: unknown) => Promise<unknown>>(async () => 0),
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(async () => null),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({})),
  },
  crawlSource: { findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []) },
  socialAccount: { findFirst: vi.fn<(args?: unknown) => Promise<unknown>>(async () => null) },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const queueMock = vi.hoisted(() => ({
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  remove: vi.fn<(args: unknown) => Promise<unknown>>(async () => undefined),
}));
vi.mock("../queue", () => ({ QUEUE_INTERPRETER: "interpreter", getQueue: () => queueMock }));

const enqueueInterpretMock = vi.hoisted(() =>
  vi.fn<(data: unknown) => Promise<void>>(async () => undefined),
);
vi.mock("./interpret-video", () => ({ enqueueInterpret: enqueueInterpretMock }));

import { aiFilterWhere, listTelegramAdmin, triggerTelegramInterpret } from "./telegram-admin";

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
  prismaMock.telegram.findUnique.mockResolvedValue(null);
  prismaMock.telegram.update.mockResolvedValue({});
  prismaMock.crawlSource.findMany.mockResolvedValue([]);
  prismaMock.socialAccount.findFirst.mockResolvedValue(null);
  enqueueInterpretMock.mockResolvedValue(undefined);
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

describe("解读态筛选(M10 批⑤)", () => {
  it("aiFilterWhere 口径:none=null;working=在途;done 含无转写降级;failed=failed", () => {
    expect(aiFilterWhere("none")).toEqual({ aiStatus: null });
    expect(aiFilterWhere("working")).toEqual({ aiStatus: { in: ["pending", "processing"] } });
    expect(aiFilterWhere("done")).toEqual({ aiStatus: { in: ["done", "missing_transcript"] } });
    expect(aiFilterWhere("failed")).toEqual({ aiStatus: "failed" });
  });

  it("listTelegramAdmin 透传:aiFilter 与分段/媒体并存,计数同 where", async () => {
    await listTelegramAdmin({ page: 1, segment: "visible", media: "video", aiFilter: "none" });
    expect(lastWhere()).toEqual({ status: "visible", mediaType: "video", aiStatus: null });
    const countCalls = prismaMock.telegram.count.mock.calls as unknown as Array<
      [{ where: Record<string, unknown> }]
    >;
    const visibleCall = countCalls.find((c) => c[0].where.status === "visible")!;
    expect(visibleCall[0].where).toEqual({
      status: "visible",
      mediaType: "video",
      aiStatus: null,
    });
  });

  it("无 aiFilter 不出 aiStatus 键(现有筛选行为不变)", async () => {
    await listTelegramAdmin({ page: 1, segment: "all" });
    expect(lastWhere()).toEqual({});
  });
});

describe("triggerTelegramInterpret(M9 手动触发)", () => {
  it("条目不存在 / 非视频 / 外链缺视频 id → 前置拒绝,不入队", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue(null);
    await expect(triggerTelegramInterpret(BigInt(1))).rejects.toMatchObject({ code: "not_found" });

    prismaMock.telegram.findUnique.mockResolvedValue({
      id: BigInt(1),
      mediaType: "text",
      url: "https://t.me/x",
    });
    await expect(triggerTelegramInterpret(BigInt(1))).rejects.toMatchObject({ code: "not_video" });

    prismaMock.telegram.findUnique.mockResolvedValue({
      id: BigInt(1),
      mediaType: "video",
      url: "https://example.com/watch",
      videoPlatform: "douyin",
      videoBlogger: "AI 前沿",
    });
    await expect(triggerTelegramInterpret(BigInt(1))).rejects.toMatchObject({ code: "no_link" });
    expect(enqueueInterpretMock).not.toHaveBeenCalled();
  });

  it("视频行:videoId 取自外链尾段,secUid 经博主台账反查,pending 重置 + 遗留 job 清理", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue({
      id: BigInt(5),
      mediaType: "video",
      url: "https://www.douyin.com/video/7301234567890",
      videoPlatform: "douyin",
      videoBlogger: "AI 前沿",
    });
    prismaMock.socialAccount.findFirst.mockResolvedValue({ secUid: "sec-9" });

    await expect(triggerTelegramInterpret(BigInt(5))).resolves.toEqual({ enqueued: true });
    expect(queueMock.remove).toHaveBeenCalledWith("interpret-5"); // 防遗留 completed job 静默去重
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(5) },
      data: { aiStatus: "pending", lastAiError: null },
    });
    expect(enqueueInterpretMock).toHaveBeenCalledWith({
      telegramId: "5",
      videoId: "7301234567890",
      playUrl: null, // 过境直链不落库,processor 现场重拉
      platform: "douyin",
      secUid: "sec-9",
    });
  });

  it("博主已删 → secUid 传 null(processor 降级处理),仍可入队", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue({
      id: BigInt(6),
      mediaType: "video",
      url: "https://www.douyin.com/video/7301234567890",
      videoPlatform: "douyin",
      videoBlogger: "已注销博主",
    });
    await triggerTelegramInterpret(BigInt(6));
    expect(enqueueInterpretMock).toHaveBeenCalledWith(expect.objectContaining({ secUid: null }));
  });

  it("入队失败 → pending 回滚为 null,错误上抛", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue({
      id: BigInt(7),
      mediaType: "video",
      url: "https://www.douyin.com/video/7301234567890",
      videoPlatform: "douyin",
      videoBlogger: "AI 前沿",
    });
    enqueueInterpretMock.mockRejectedValue(new Error("redis down"));
    await expect(triggerTelegramInterpret(BigInt(7))).rejects.toThrow("redis down");
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(7) },
      data: { aiStatus: null },
    });
  });
});
