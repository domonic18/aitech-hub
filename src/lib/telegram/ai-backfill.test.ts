/**
 * AI 存量补扫单测(M12 批③):prisma/queue/resolver 全打桩,验——
 * 按 mediaType 分流入对应队列、每类 5 条上限、未绑定模型整类跳过(防空转)、
 * 入队前移除同名遗留 job、先标 pending、单条失败不拖垮整轮。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  telegram: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({})),
  },
  socialAccount: {
    findFirst: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({ secUid: "sec-1" })),
  },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

const queues = vi.hoisted(() => ({
  interpreter: {
    add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
    remove: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  },
  summarizer: {
    add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
    remove: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  },
}));
vi.mock("../queue", () => ({
  QUEUE_CRAWLER: "crawler",
  QUEUE_INTERPRETER: "interpreter",
  QUEUE_SUMMARIZER: "summarizer",
  QUEUE_GITHUB: "github",
  QUEUE_NAMES: ["crawler", "interpreter", "summarizer", "github"],
  getQueue: (name: string) => (name === "interpreter" ? queues.interpreter : queues.summarizer),
}));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// interpret-video 导入链含 asr-admin → secret-box → env、douyin adapter → env;桩掉避开环境变量校验
vi.mock("../crypto/secret-box", () => ({ decryptSecret: vi.fn(() => "k") }));
vi.mock("./adapters/video/douyin", () => ({
  douyinAdapter: { fetchRecentVideos: vi.fn(async () => []) },
}));

vi.mock("../ai/resolver", () => ({
  getRoleDailyMax: vi.fn(async () => 100),
  resolveAiModel: vi.fn(async (role: string) =>
    role === "interpret" || role === "summarize"
      ? {
          id: 1,
          name: "m",
          protocol: "openai",
          baseUrl: "https://llm.test/v1",
          modelId: "m1",
          apiKey: "sk",
          timeoutSec: 60,
          concurrency: 1,
          supportsVision: false,
        }
      : null,
  ),
}));

import { AI_BACKFILL_PER_TYPE, backfillAiPending } from "./ai-backfill";

function videoRow(id: number): unknown {
  return {
    id: BigInt(id),
    url: `https://www.douyin.com/video/vid${id}`,
    videoPlatform: "douyin",
    videoBlogger: "博主",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.telegram.findMany.mockResolvedValue([]);
  prismaMock.socialAccount.findFirst.mockResolvedValue({ secUid: "sec-1" });
});

describe("backfillAiPending", () => {
  it("视频/文字分别入对应队列:先移除遗留 job,再标 pending,jobId/playUrl 锚正确", async () => {
    prismaMock.telegram.findMany.mockImplementation(async (args?: unknown) => {
      const where = (args as { where?: { mediaType?: string } }).where as {
        mediaType?: string;
      };
      return where?.mediaType === "video" ? [videoRow(1)] : [{ id: BigInt(11) }];
    });
    const outcome = await backfillAiPending();
    expect(outcome).toEqual({ video: 1, text: 1 });

    expect(queues.interpreter.remove).toHaveBeenCalledWith("interpret-1");
    expect(queues.interpreter.add).toHaveBeenCalledWith(
      "interpret-video",
      {
        telegramId: "1",
        videoId: "vid1",
        playUrl: null,
        platform: "douyin",
        secUid: "sec-1",
      },
      expect.objectContaining({ jobId: "interpret-1" }),
    );
    // pending 标记(video 行 1 次 + 文字行 11 一次)
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "pending", lastAiError: null },
    });
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(11) },
      data: { aiStatus: "pending", lastAiError: null },
    });
    expect(queues.summarizer.remove).toHaveBeenCalledWith("summarize-11");
    expect(queues.summarizer.add).toHaveBeenCalledWith(
      "summarize-text",
      { telegramId: "11" },
      expect.objectContaining({ jobId: "summarize-11" }),
    );
  });

  it("模型未绑定 → 对应类整跳过(不查询该类也不入队)", async () => {
    const { resolveAiModel } = await import("../ai/resolver");
    // 首调用即 isInterpretReady → null;summarize 保持模块默认(有绑定)
    vi.mocked(resolveAiModel).mockResolvedValueOnce(null);
    const outcome = await backfillAiPending();
    expect(outcome).toEqual({ video: 0, text: 0 });
    expect(queues.interpreter.add).not.toHaveBeenCalled();
    expect(queues.summarizer.add).toHaveBeenCalledTimes(0);
  });

  it("每类条数上限透传 take=5;查询锚定未解读可见条 + 7 天窗", async () => {
    prismaMock.telegram.findMany.mockResolvedValue([]);
    await backfillAiPending();
    for (const call of prismaMock.telegram.findMany.mock.calls) {
      const arg = call[0] as {
        where: { aiStatus: unknown; status: string; OR: unknown[] };
        take: number;
      };
      expect(arg.where.aiStatus).toBeNull();
      expect(arg.where.status).toBe("visible");
      expect(arg.where.OR).toHaveLength(2);
      expect(arg.take).toBe(AI_BACKFILL_PER_TYPE);
    }
  });

  it("单条入队失败只跳过该条,不拖垮整轮", async () => {
    prismaMock.telegram.findMany.mockImplementation(async (args?: unknown) => {
      const where = (args as { where?: { mediaType?: string } }).where as {
        mediaType?: string;
      };
      return where?.mediaType === "video" ? [videoRow(1), videoRow(2)] : [{ id: BigInt(11) }];
    });
    queues.interpreter.add.mockRejectedValueOnce(new Error("redis down"));
    const outcome = await backfillAiPending();
    expect(outcome).toEqual({ video: 1, text: 1 });
    expect(queues.interpreter.add).toHaveBeenCalledTimes(2);
  });
});
