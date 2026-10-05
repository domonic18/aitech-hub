/**
 * 文字轻解读编排单测(M12 批③):prisma/queue/LLM 客户端全打桩,验状态机分支——
 * 幂等 skip、summarize 未绑定不标败、配额顺延重投(文字行口径)、
 * 摘要 <80 字抓原文与失败静默降级、LLM 网络败上抛/解析败 failed 不烧 attempts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  telegram: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({})),
    count: vi.fn<(args?: unknown) => Promise<unknown>>(async () => 0),
  },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  remove: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("../queue", () => ({
  QUEUE_CRAWLER: "crawler",
  QUEUE_INTERPRETER: "interpreter",
  QUEUE_SUMMARIZER: "summarizer",
  QUEUE_GITHUB: "github",
  QUEUE_NAMES: ["crawler", "interpreter", "summarizer", "github"],
  getQueue: () => queueMock,
}));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const dailyMaxMock = vi.hoisted(() => vi.fn<(args?: unknown) => Promise<number>>(async () => 2));
vi.mock("../ai/resolver", () => ({
  getRoleDailyMax: dailyMaxMock,
  resolveAiModel: vi.fn(async () => ({
    id: 2,
    name: "m",
    protocol: "openai",
    baseUrl: "https://llm.test/v1",
    modelId: "deepseek-chat",
    apiKey: "sk",
    timeoutSec: 60,
    concurrency: 1,
    supportsVision: false,
  })),
}));

// LLM 默认回合法 JSON(parseSummarizeResult/buildSummarizePrompt 用真实现)
const GOOD_JSON = vi.hoisted(() =>
  JSON.stringify({
    summary: "一句话中心思想",
    points: ["要点一", "要点二", "要点三"],
    keywords: ["关键词一", "关键词二", "关键词三"],
  }),
);
const chatJsonMock = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<string>>(async () => GOOD_JSON),
);
vi.mock("../ai/llm-client", () => ({ chatJson: chatJsonMock }));

import {
  markPendingAndEnqueueSummarize,
  summarizeJobId,
  summarizeTextJob,
  type SummarizeJobData,
} from "./summarize-text";

const ROW = {
  id: 1,
  title: "标题",
  summary: "这是一段足够长的 RSS 摘要内容,超过八十字的阈值就不会触发原文抓取逻辑,直接用摘要提炼。",
  url: "https://example.com/a",
  aiStatus: null,
};
const DATA: SummarizeJobData = { telegramId: "1" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.telegram.findUnique.mockResolvedValue(ROW);
  prismaMock.telegram.update.mockResolvedValue({});
  prismaMock.telegram.count.mockResolvedValue(0);
  chatJsonMock.mockResolvedValue(GOOD_JSON);
  queueMock.add.mockResolvedValue(undefined);
  queueMock.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("summarizeTextJob 状态机", () => {
  it("成功全链:processing → done,aiSummary/aiPoints(要点)/aiKeywords(关键词)/aiTopic=null 落库", async () => {
    const outcome = await summarizeTextJob(DATA);
    expect(outcome).toEqual({ telegramId: "1", status: "done" });
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "processing", lastAiError: null },
    });
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(1) },
      data: {
        aiStatus: "done",
        aiTopic: null,
        aiSummary: "一句话中心思想",
        aiPoints: ["要点一", "要点二", "要点三"],
        aiKeywords: ["关键词一", "关键词二", "关键词三"],
        aiRanAt: expect.any(Date),
        lastAiError: null,
      },
    });
    expect(chatJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk",
        system: expect.stringContaining("JSON"),
        user: expect.stringContaining("摘要:"),
      }),
    );
  });

  it("done 幂等 skip;行已删除 → skipped_not_found", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue({ ...ROW, aiStatus: "done" });
    expect((await summarizeTextJob(DATA)).status).toBe("skipped_done");
    prismaMock.telegram.findUnique.mockResolvedValue(null);
    expect((await summarizeTextJob(DATA)).status).toBe("skipped_not_found");
    expect(chatJsonMock).not.toHaveBeenCalled();
  });

  it("summarize 未绑定 → skipped_not_ready:aiStatus 不动仅落提示", async () => {
    const { resolveAiModel } = await import("../ai/resolver");
    vi.mocked(resolveAiModel).mockResolvedValueOnce(null);
    const outcome = await summarizeTextJob(DATA);
    expect(outcome.status).toBe("skipped_not_ready");
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { lastAiError: expect.stringContaining("未启用") },
    });
  });

  it("日配额满(文字行口径)→ 延迟 30min 重投顺延,不标败", async () => {
    prismaMock.telegram.count.mockResolvedValue(2); // == getRoleDailyMax mock(2)
    const outcome = await summarizeTextJob(DATA);
    expect(outcome.status).toBe("deferred_quota");
    expect(queueMock.add).toHaveBeenCalledWith(
      "summarize-text",
      DATA,
      expect.objectContaining({
        jobId: expect.stringMatching(/^summarize-1-r\d+$/),
        delay: 30 * 60_000,
      }),
    );
    expect(prismaMock.telegram.update).not.toHaveBeenCalled();
  });

  it("摘要 <80 字且外链在 → 抓原文进 prompt;原文抓取失败静默降级仅用摘要", async () => {
    prismaMock.telegram.findUnique.mockResolvedValue({ ...ROW, summary: "太短" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html><body><p>原始正文内容,足够支撑提炼。</p></body></html>"),
      ),
    );
    await summarizeTextJob(DATA);
    expect(chatJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.stringContaining("原始正文内容") }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await summarizeTextJob(DATA);
    expect(chatJsonMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ user: expect.not.stringContaining("正文粗提取") }),
    );
  });

  it("LLM 网络错误 → 标 failed 后上抛(attempts 兜重试)", async () => {
    chatJsonMock.mockRejectedValue(new Error("boom"));
    await expect(summarizeTextJob(DATA)).rejects.toThrow("boom");
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "failed", lastAiError: "boom" },
    });
  });

  it("LLM 输出不成 JSON(含一次解析重试)→ failed 返回,不烧 attempts", async () => {
    chatJsonMock.mockResolvedValue("不是 JSON 的回答");
    const outcome = await summarizeTextJob(DATA);
    expect(outcome).toMatchObject({ status: "failed" });
    expect(chatJsonMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.telegram.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { aiStatus: "failed", lastAiError: expect.stringContaining("LLM 输出无法解析") },
    });
  });
});

describe("入队契约", () => {
  it("markPendingAndEnqueueSummarize 先标 pending 再入队,入队败回滚 null", async () => {
    const order: string[] = [];
    prismaMock.telegram.update.mockImplementation(async () => {
      order.push("update");
      return {};
    });
    queueMock.add.mockImplementation(async () => {
      order.push("add");
      return undefined;
    });
    await markPendingAndEnqueueSummarize(BigInt(9));
    expect(order).toEqual(["update", "add"]);
    expect(queueMock.add).toHaveBeenCalledWith(
      "summarize-text",
      { telegramId: "9" },
      expect.objectContaining({ jobId: "summarize-9", removeOnComplete: 50 }),
    );

    queueMock.add.mockRejectedValue(new Error("redis down"));
    await expect(markPendingAndEnqueueSummarize(BigInt(9))).rejects.toThrow("redis down");
    expect(prismaMock.telegram.update).toHaveBeenLastCalledWith({
      where: { id: BigInt(9) },
      data: { aiStatus: null },
    });
  });

  it("summarizeJobId 幂等锚与顺延后缀(连字符分隔)", () => {
    expect(summarizeJobId("5")).toBe("summarize-5");
    expect(summarizeJobId("5", "r123")).toBe("summarize-5-r123");
  });
});
