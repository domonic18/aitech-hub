/**
 * 视频采集编排单测:db/queue/logger/cookies/适配器/redis 全打桩,
 * 验编排语义——增量地板、首采回填窗口、去重、过滤、失败归因(风控 vs 网关不可达)、
 * 手动回填(批⑧:30 天窗/不设条帽/maxPages 深扫/地板推进不回退)、
 * 解读入队钩子(M9:可见+就绪+直链才入队,playUrl 不落库红线)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  socialAccount: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({})),
  },
  telegram: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(async () => null),
    create: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({ id: 1 })),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({})),
  },
  blocklist: { findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []) },
}));
vi.mock("../db", () => ({
  prisma: prismaMock,
  isP2002: (err: unknown) =>
    typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002",
}));

const queueMock = vi.hoisted(() => ({
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("../queue", () => ({
  CRAWL_JOB_VIDEO: "crawl-video",
  QUEUE_CRAWLER: "crawler",
  getQueue: () => queueMock,
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const cookiesMock = vi.hoisted(() => ({ decryptJars: vi.fn((): string[] => []) }));
vi.mock("./cookies", () => ({ decryptJars: cookiesMock.decryptJars }));

// 解读模块整桩(管道本体不进本测试面;默认未就绪使既有用例零入队)。
// markPendingAndEnqueue 镜像真实「pending→入队→失败回滚」语义;不变量本体由
// interpret-video.test 对真实现钉死
const interpretMock = vi.hoisted(() => ({
  isInterpretReady: vi.fn(async (): Promise<boolean> => false),
  enqueueInterpret: vi.fn<(data: unknown) => Promise<void>>(async () => undefined),
  markPendingAndEnqueue: vi.fn(
    async (telegramId: bigint | number, data: Record<string, unknown>): Promise<void> => {
      await prismaMock.telegram.update({
        where: { id: telegramId },
        data: { aiStatus: "pending", lastAiError: null },
      });
      try {
        await interpretMock.enqueueInterpret({ telegramId: String(telegramId), ...data });
      } catch (err) {
        await prismaMock.telegram
          .update({ where: { id: telegramId }, data: { aiStatus: null } })
          .catch(() => undefined);
        throw err;
      }
    },
  ),
}));
vi.mock("./interpret-video", () => ({
  isInterpretReady: interpretMock.isInterpretReady,
  enqueueInterpret: interpretMock.enqueueInterpret,
  markPendingAndEnqueue: interpretMock.markPendingAndEnqueue,
}));

// 真实 rate-limit + 内存 redis(照 rate-limit.test.ts 口径)
const quotaStore = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/redis", () => ({
  redis: {
    incr: async (k: string) => {
      const n = Number(quotaStore.get(k) ?? "0") + 1;
      quotaStore.set(k, String(n));
      return n;
    },
    expire: async () => 1,
  },
}));

vi.mock("./adapters/video/douyin", async () => {
  // 错误类从纯接口文件取(importOriginal 会连带真 douyin.ts → env 校验)
  const { GatewayUnavailableError, GatewayUpstreamError } = await import("./adapters/video/index");
  return {
    douyinAdapter: { platform: "douyin", fetchRecentVideos: vi.fn(async () => []) },
    GatewayUnavailableError,
    GatewayUpstreamError,
  };
});

import { crawlVideoAccount, enqueueDueVideoAccounts, type VideoCrawlOutcome } from "./ingest-video";
import { douyinAdapter } from "./adapters/video/douyin";
import { GatewayUnavailableError, GatewayUpstreamError } from "./adapters/video/index";

const fetchVideosMock = vi.mocked(douyinAdapter.fetchRecentVideos);

function makeAccount(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    platform: "douyin",
    secUid: "sec-abc",
    nickname: "AI 前沿",
    enabled: true,
    crawlIntervalMin: 120,
    lastPostAt: null,
    consecutiveFails: 0,
    platformRow: {
      id: 10,
      enabled: true,
      dailyMaxRequests: null,
      config: { cookieJars: "aes-cipher" },
    },
    ...over,
  };
}

function videoItem(
  i: number,
  publishedAt: Date,
  caption = `视频 ${i} 描述`,
  playUrl: string | null = null,
) {
  return {
    videoId: `vid-${i}`,
    title: caption.split("\n")[0]!,
    caption,
    url: `https://www.douyin.com/video/vid-${i}`,
    publishedAt,
    coverUrl: null,
    durationSeconds: 60,
    engagement: { play: null, like: 1, comment: 2 },
    topicTags: [],
    playUrl,
  };
}

/** 最近一次 socialAccount.update 的 data 参数 */
function lastUpdateData(): Record<string, unknown> {
  const call = prismaMock.socialAccount.update.mock.calls.at(-1) as
    [{ data: Record<string, unknown> }] | undefined;
  return call![0].data;
}

const HOUR = 3_600_000;

async function run(
  account: Record<string, unknown>,
  opts?: { backfill?: boolean },
): Promise<VideoCrawlOutcome> {
  prismaMock.socialAccount.findUnique.mockResolvedValue(account);
  return crawlVideoAccount(1, opts);
}

beforeEach(() => {
  vi.clearAllMocks();
  quotaStore.clear();
  cookiesMock.decryptJars.mockReturnValue(["ttwid=a; b=1; c=2"]);
  interpretMock.isInterpretReady.mockResolvedValue(false);
  interpretMock.enqueueInterpret.mockResolvedValue(undefined);
  prismaMock.telegram.findUnique.mockResolvedValue(null);
  prismaMock.telegram.create.mockResolvedValue({ id: 1 });
  prismaMock.telegram.update.mockResolvedValue({});
  prismaMock.socialAccount.update.mockResolvedValue({});
  prismaMock.socialAccount.findMany.mockResolvedValue([]);
  prismaMock.blocklist.findMany.mockResolvedValue([]);
});

describe("crawlVideoAccount 短路与跳过", () => {
  it("账号不存在/停用 → 空结果,不触网关", async () => {
    prismaMock.socialAccount.findUnique.mockResolvedValue(null);
    expect(await crawlVideoAccount(1)).toMatchObject({ fetched: 0, inserted: 0 });
    expect(fetchVideosMock).not.toHaveBeenCalled();

    await run(makeAccount({ enabled: false }));
    expect(fetchVideosMock).not.toHaveBeenCalled();

    await run(makeAccount({ platformRow: { id: 10, enabled: false } }));
    expect(fetchVideosMock).not.toHaveBeenCalled();
  });

  it("Cookie 池为空 → 记 last_error 顺延,不计失败不触网关", async () => {
    cookiesMock.decryptJars.mockReturnValue([]);
    const outcome = await run(makeAccount({ consecutiveFails: 2 }));
    expect(outcome.skippedNoCookies).toBe(true);
    expect(fetchVideosMock).not.toHaveBeenCalled();
    expect(lastUpdateData()).toEqual(
      expect.objectContaining({ lastError: "Cookie 池为空(待导入)" }),
    );
    expect(lastUpdateData()).not.toHaveProperty("consecutiveFails"); // 运营缺口不算采集失败
  });

  it("平台日上限超限 → 只顺延不触网关", async () => {
    quotaStore.set("crawler:req:10:2026-10-04", "3");
    const outcome = await run(
      makeAccount({
        platformRow: { id: 10, enabled: true, dailyMaxRequests: 3, config: { cookieJars: "x" } },
      }),
    );
    expect(outcome.skippedDailyCap).toBe(true);
    expect(fetchVideosMock).not.toHaveBeenCalled();
  });
});

describe("crawlVideoAccount 增量与去重", () => {
  it("首采回填:7 天窗口内限 10 条,地板推进取全量最大发布时间", async () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      videoItem(i, new Date(Date.now() - (i + 1) * HOUR)),
    );
    fetchVideosMock.mockResolvedValue(items);

    const outcome = await run(makeAccount({ lastPostAt: null }));
    expect(outcome.fetched).toBe(12);
    expect(outcome.inserted).toBe(10); // 回填条数上限
    expect(prismaMock.telegram.create).toHaveBeenCalledTimes(10);
    expect(lastUpdateData().lastPostAt).toEqual(items[0]!.publishedAt); // 含被截断条,防下轮重扫
  });

  it("首采窗口外的旧作不采", async () => {
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - 2 * HOUR)),
      videoItem(2, new Date(Date.now() - 8 * 24 * HOUR)), // 超 7 天窗口
    ]);
    const outcome = await run(makeAccount({ lastPostAt: null }));
    expect(outcome.inserted).toBe(1);
    expect(prismaMock.telegram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ url: "https://www.douyin.com/video/vid-1" }),
      }),
    );
  });

  it("增量地板:只采新于 last_post_at 的条目,地板推进到最新", async () => {
    const floor = new Date(Date.now() - 24 * HOUR);
    const fresh = videoItem(1, new Date(Date.now() - 1 * HOUR));
    fetchVideosMock.mockResolvedValue([
      fresh, // 新于地板
      videoItem(2, new Date(Date.now() - 30 * HOUR)), // 旧于地板
    ]);
    const outcome = await run(makeAccount({ lastPostAt: floor }));
    expect(outcome.inserted).toBe(1);
    expect(lastUpdateData().lastPostAt).toEqual(fresh.publishedAt);
  });

  it("hash 已存在与并发 P2002 都记 duplicated", async () => {
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - HOUR)),
      videoItem(2, new Date(Date.now() - 2 * HOUR)),
    ]);
    prismaMock.telegram.findUnique
      .mockResolvedValueOnce({ id: 99 }) // 第 1 条 hash 已存在
      .mockResolvedValueOnce(null);
    prismaMock.telegram.create.mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "P2002" }), // 第 2 条并发抢先
    );

    const outcome = await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) }));
    expect(outcome.duplicated).toBe(2);
    expect(outcome.inserted).toBe(0);
  });

  it("屏蔽词命中 → hidden 落库记 filter_hit,sourceId 锚平台行", async () => {
    prismaMock.blocklist.findMany.mockResolvedValue([{ word: "广告", scope: "all" }]);
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - HOUR), "推广一条广告合作"),
    ]);
    const outcome = await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) }));
    expect(outcome.filtered).toBe(1);
    expect(prismaMock.telegram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "hidden",
          filterHit: "blocklist:广告",
          mediaType: "video",
          videoBlogger: "AI 前沿",
          sourceId: 10, // sourceId 锚平台行
        }),
      }),
    );
  });
});

describe("解读入队钩子(M9)", () => {
  const PLAY_URL = "https://v.douyinvod.com/preview.mp4";

  it("可见条 + 就绪 + 直链 → 入队(data 带 telegramId/videoId/playUrl/secUid)", async () => {
    interpretMock.isInterpretReady.mockResolvedValue(true);
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - HOUR), "视频 1 描述", PLAY_URL),
    ]);
    const outcome = await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) }));
    expect(outcome.inserted).toBe(1);
    expect(interpretMock.enqueueInterpret).toHaveBeenCalledWith({
      telegramId: "1",
      videoId: "vid-1",
      playUrl: PLAY_URL,
      platform: "douyin",
      secUid: "sec-abc",
    });
    // 先标 pending 再入队(worker 可能先于入队返回开跑,反序会把 processing 打回)
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { aiStatus: "pending", lastAiError: null },
    });
  });

  it("版权红线:落库 data 永不含 playUrl(适配器透传仅到 job data)", async () => {
    interpretMock.isInterpretReady.mockResolvedValue(true);
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - HOUR), "视频 1 描述", PLAY_URL),
    ]);
    await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) }));
    const createData = (
      prismaMock.telegram.create.mock.calls.at(-1) as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(createData).not.toHaveProperty("playUrl");
    expect(JSON.stringify(createData)).not.toContain("douyinvod");
  });

  it("未就绪 / 无直链 / filtered / duplicated 均不入队", async () => {
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - HOUR), "视频 1 描述", PLAY_URL),
      videoItem(2, new Date(Date.now() - 2 * HOUR), "视频 2 描述", null),
    ]);
    await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) })); // 默认未就绪
    expect(interpretMock.enqueueInterpret).not.toHaveBeenCalled();

    interpretMock.isInterpretReady.mockResolvedValue(true);
    await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) })); // 第 2 条无直链
    expect(interpretMock.enqueueInterpret).toHaveBeenCalledTimes(1);

    prismaMock.blocklist.findMany.mockResolvedValue([{ word: "广告", scope: "all" }]);
    fetchVideosMock.mockResolvedValue([
      videoItem(3, new Date(Date.now() - HOUR), "推广一条广告合作", PLAY_URL),
    ]);
    await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) })); // filtered 不入队
    expect(interpretMock.enqueueInterpret).toHaveBeenCalledTimes(1);
  });

  it("入队失败不拖垮采集轮:条目照常 inserted,仅 warn", async () => {
    interpretMock.isInterpretReady.mockResolvedValue(true);
    interpretMock.enqueueInterpret.mockRejectedValue(new Error("redis down"));
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - HOUR), "视频 1 描述", PLAY_URL),
    ]);
    const outcome = await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) }));
    expect(outcome.inserted).toBe(1);
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { aiStatus: null }, // 残留 pending 无 job 兜底,回滚
    });
  });
});

describe("crawlVideoAccount 失败归因", () => {
  it("网关不可达 → 顺延不计连续失败,仍上抛(BullMQ failed 可见)", async () => {
    fetchVideosMock.mockRejectedValue(new GatewayUnavailableError("ECONNREFUSED"));
    await expect(run(makeAccount({ consecutiveFails: 1 }))).rejects.toBeInstanceOf(
      GatewayUnavailableError,
    );
    expect(lastUpdateData()).not.toHaveProperty("consecutiveFails");
    expect(lastUpdateData()).not.toHaveProperty("lastError");
  });

  it("上游风控 → 连续失败递增 + last_error,仍上抛", async () => {
    fetchVideosMock.mockRejectedValue(new GatewayUpstreamError("AccountInvalidError", "jar 全灭"));
    await expect(run(makeAccount({ consecutiveFails: 1 }))).rejects.toBeInstanceOf(
      GatewayUpstreamError,
    );
    expect(lastUpdateData()).toEqual(
      expect.objectContaining({
        consecutiveFails: 2,
        lastError: expect.stringContaining("AccountInvalidError"),
      }),
    );
  });

  it("成功清零连续失败并清 last_error", async () => {
    fetchVideosMock.mockResolvedValue([videoItem(1, new Date(Date.now() - HOUR))]);
    await run(makeAccount({ consecutiveFails: 2, lastError: "旧错误" }));
    expect(lastUpdateData()).toEqual(
      expect.objectContaining({ consecutiveFails: 0, lastError: null }),
    );
  });
});

describe("crawlVideoAccount 手动回填(批⑧)", () => {
  it("30 天窗覆盖增量地板与首采条帽:last_post_at 之后的 12 条旧作全采", async () => {
    const items = Array.from(
      { length: 12 },
      (_, i) => videoItem(100 + i, new Date(Date.now() - (2 + i) * 24 * HOUR)), // 2~13 天前,均旧于地板
    );
    fetchVideosMock.mockResolvedValue(items);

    const outcome = await run(makeAccount({ lastPostAt: new Date(Date.now() - 24 * HOUR) }), {
      backfill: true,
    });
    expect(outcome.backfill).toBe(true);
    expect(outcome.fetched).toBe(12);
    expect(outcome.inserted).toBe(12); // 增量地板只放行 0 条、首采帽 10 条,回填双双绕过
  });

  it("首采 + 回填:7 天窗外的 20 天前旧作也采,40 天前仍不采", async () => {
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - 20 * 24 * HOUR)),
      videoItem(2, new Date(Date.now() - 40 * 24 * HOUR)),
    ]);
    const outcome = await run(makeAccount({ lastPostAt: null }), { backfill: true });
    expect(outcome.inserted).toBe(1);
    expect(prismaMock.telegram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ url: "https://www.douyin.com/video/vid-1" }),
      }),
    );
  });

  it("maxPages 仅回填轮透传(3),常规轮不传该键", async () => {
    fetchVideosMock.mockResolvedValue([]);
    await run(makeAccount({ lastPostAt: null }), { backfill: true });
    expect(fetchVideosMock).toHaveBeenCalledWith(expect.objectContaining({ maxPages: 3 }));

    await run(makeAccount({ lastPostAt: null }));
    expect(fetchVideosMock.mock.calls.at(-1)![0]).not.toHaveProperty("maxPages");
  });

  it("常规轮 outcome.backfill 为 false(既有路径形状不变)", async () => {
    fetchVideosMock.mockResolvedValue([]);
    const outcome = await run(makeAccount({ lastPostAt: null }));
    expect(outcome.backfill).toBe(false);
  });

  it("回填全为窗外旧作:candidates 为 0 且地板推进不回退(守卫锚 last_post_at)", async () => {
    const lastPostAt = new Date(Date.now() - 2 * 24 * HOUR);
    fetchVideosMock.mockResolvedValue([
      videoItem(1, new Date(Date.now() - 40 * 24 * HOUR)), // 超 30 天回填窗
      videoItem(2, new Date(Date.now() - 45 * 24 * HOUR)),
    ]);
    const outcome = await run(makeAccount({ lastPostAt }), { backfill: true });
    expect(outcome.inserted).toBe(0);
    expect(lastUpdateData().lastPostAt).toEqual(lastPostAt); // 若无 Math.max 守卫会被拉回 now-30d
  });

  it("回填采到旧作但不越过更高 last_post_at:推进取三者最大", async () => {
    const lastPostAt = new Date(Date.now() - 24 * HOUR);
    fetchVideosMock.mockResolvedValue([videoItem(1, new Date(Date.now() - 3 * 24 * HOUR))]);
    await run(makeAccount({ lastPostAt }), { backfill: true });
    expect(lastUpdateData().lastPostAt).toEqual(lastPostAt); // max(采到 now-3d, 原值 now-1d) = 原值
  });
});

describe("enqueueDueVideoAccounts", () => {
  it("到期博主逐个入队,jobId 锚定到期时刻", async () => {
    const at = new Date("2026-10-04T00:00:00Z");
    prismaMock.socialAccount.findMany.mockResolvedValue([
      { id: 1, nextRunAt: null },
      { id: 2, nextRunAt: at },
    ]);
    expect(await enqueueDueVideoAccounts()).toEqual({ due: 2 });
    expect(queueMock.add).toHaveBeenCalledTimes(2);
    expect(queueMock.add).toHaveBeenCalledWith(
      "crawl-video",
      { accountId: 1 },
      expect.objectContaining({ jobId: "crawl-video-1-0" }),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      "crawl-video",
      { accountId: 2 },
      expect.objectContaining({ jobId: `crawl-video-2-${at.getTime()}` }),
    );
  });
});
