/** 信号翻译状态机单测(M58 批①,prisma/redis/LLM 全 mock 无真库):
 * 只翻 pending(幂等跳过)/缓存命中不调模型/未绑定保持 pending/成功顶替
 * normalizedText/空译文重试后 failed/超 24h 降级/批处理未绑定即停。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const signalFindFirst = vi.fn();
const signalUpdateMany = vi.fn();
const signalFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    insightSignal: {
      findFirst: (...a: unknown[]) => signalFindFirst(...a),
      updateMany: (...a: unknown[]) => signalUpdateMany(...a),
      findMany: (...a: unknown[]) => signalFindMany(...a),
    },
  },
}));

const redisGet = vi.fn();
const redisSet = vi.fn();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: (...a: unknown[]) => redisGet(...a),
    set: (...a: unknown[]) => redisSet(...a),
  },
}));

const resolveModel = vi.fn();
vi.mock("./model", () => ({
  resolveInsightModel: (...a: unknown[]) => resolveModel(...a),
}));

const chatText = vi.fn();
vi.mock("@/lib/ai/llm-client", () => ({
  chatText: (...a: unknown[]) => chatText(...a),
}));

const recordAiUsage = vi.fn();
vi.mock("@/lib/ai/usage-log", () => ({
  recordAiUsage: (...a: unknown[]) => recordAiUsage(...a),
}));

const loggerWarn = vi.fn();
const loggerInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: (...a: unknown[]) => loggerWarn(...a),
    info: (...a: unknown[]) => loggerInfo(...a),
  },
}));

import {
  degradeStalePendingTranslations,
  runInsightTranslateBatch,
  translateSignal,
} from "./translate";

const MODEL = {
  id: "m-1",
  protocol: "openai",
  baseUrl: "https://llm.test/v1",
  modelId: "translate-cheap",
  apiKey: "sk-test",
  timeoutSec: 30,
};

const ROW = { id: BigInt(7), rawText: "How to install Claude Code", lang: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  signalFindFirst.mockResolvedValue(ROW);
  signalUpdateMany.mockResolvedValue({ count: 1 });
  signalFindMany.mockResolvedValue([]);
  redisGet.mockResolvedValue(null);
  redisSet.mockResolvedValue("OK");
  resolveModel.mockResolvedValue(MODEL);
  chatText.mockImplementation(async (_cfg: unknown, onUsage?: (u: unknown) => void) => {
    onUsage?.({ tokensIn: 10, tokensOut: 20 });
    return "  如何安装 Claude Code  ";
  });
});

describe("translateSignal 状态机", () => {
  it("非 pending(查无)→ skipped:不读缓存不调模型(重复 job 幂等)", async () => {
    signalFindFirst.mockResolvedValue(null);
    expect(await translateSignal(BigInt(7))).toBe("skipped");
    expect(redisGet).not.toHaveBeenCalled();
    expect(chatText).not.toHaveBeenCalled();
    expect(signalUpdateMany).not.toHaveBeenCalled();
  });

  it("只认 pending:查询条件锁 translation_status,防并发重复翻译", async () => {
    await translateSignal(BigInt(7));
    expect(signalFindFirst).toHaveBeenCalledWith({
      where: { id: BigInt(7), translationStatus: "pending" },
      select: { id: true, rawText: true, lang: true },
    });
  });

  it("缓存命中 → cached:译文顶替 normalizedText,不调模型不写缓存", async () => {
    redisGet.mockResolvedValue("缓存译文");
    expect(await translateSignal(BigInt(7))).toBe("cached");
    expect(chatText).not.toHaveBeenCalled();
    expect(signalUpdateMany).toHaveBeenCalledWith({
      where: { id: BigInt(7), translationStatus: "pending" },
      data: {
        translatedText: "缓存译文",
        normalizedText: "缓存译文",
        translationStatus: "done",
      },
    });
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("角色未绑定/baseUrl 缺 → unbound:保持 pending 零写入(24h 降级兜底)", async () => {
    resolveModel.mockResolvedValue(null);
    expect(await translateSignal(BigInt(7))).toBe("unbound");
    expect(signalUpdateMany).not.toHaveBeenCalled();
    expect(chatText).not.toHaveBeenCalled();
  });

  it("翻译成功 → done:trim 后落库、写缓存、按 role=translate 记账", async () => {
    expect(await translateSignal(BigInt(7))).toBe("done");
    expect(signalUpdateMany).toHaveBeenCalledWith({
      where: { id: BigInt(7), translationStatus: "pending" },
      data: {
        translatedText: "如何安装 Claude Code",
        normalizedText: "如何安装 Claude Code",
        translationStatus: "done",
      },
    });
    expect(redisSet).toHaveBeenCalledWith(
      expect.stringMatching(/^insight:translate:[0-9a-f]{40}$/),
      "如何安装 Claude Code",
      "EX",
      7 * 24 * 3600,
    );
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "translate", modelId: "m-1", tokensIn: 10, tokensOut: 20 }),
    );
  });

  it("空译文重试 RETRY_MAX+1 次后 → failed:只落状态保留原文", async () => {
    chatText.mockResolvedValue("   ");
    expect(await translateSignal(BigInt(7))).toBe("failed");
    expect(chatText).toHaveBeenCalledTimes(3);
    expect(signalUpdateMany).toHaveBeenCalledWith({
      where: { id: BigInt(7), translationStatus: "pending" },
      data: { translationStatus: "failed" },
    });
    expect(redisSet).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "insight.translate_failed", signalId: "7" }),
    );
  });

  it("首次失败、二次成功 → done(重试不重复记账)", async () => {
    chatText
      .mockRejectedValueOnce(new Error("502"))
      .mockImplementation(async (_cfg: unknown, onUsage?: (u: unknown) => void) => {
        onUsage?.({ tokensIn: 1, tokensOut: 1 });
        return "译文";
      });
    expect(await translateSignal(BigInt(7))).toBe("done");
    expect(chatText).toHaveBeenCalledTimes(2);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
  });
});

describe("degradeStalePendingTranslations", () => {
  it("pending 超 24h → 降级 failed,返回条数并告警", async () => {
    signalUpdateMany.mockResolvedValue({ count: 3 });
    const before = Date.now();
    expect(await degradeStalePendingTranslations()).toBe(3);
    const call = signalUpdateMany.mock.calls[0][0] as {
      where: { translationStatus: string; createdAt: { lt: Date } };
      data: { translationStatus: string };
    };
    expect(call.where.translationStatus).toBe("pending");
    expect(call.data).toEqual({ translationStatus: "failed" });
    const cutoff = call.where.createdAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 24 * 3600 * 1000 - 1000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 24 * 3600 * 1000 + 1000);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "insight.translate_stale_degraded", count: 3 }),
    );
  });

  it("无超时 pending → 零告警", async () => {
    signalUpdateMany.mockResolvedValue({ count: 0 });
    expect(await degradeStalePendingTranslations()).toBe(0);
    expect(loggerWarn).not.toHaveBeenCalled();
  });
});

describe("runInsightTranslateBatch", () => {
  it("未绑定模型 → 首条 unbound 即停,剩余行不耗调用", async () => {
    signalFindMany.mockResolvedValue([{ id: BigInt(1) }, { id: BigInt(2) }]);
    resolveModel.mockResolvedValue(null);
    const r = await runInsightTranslateBatch();
    expect(r).toMatchObject({ pending: 2, unbound: true, done: 0, cached: 0, failed: 0 });
    expect(chatText).not.toHaveBeenCalled();
    // 仍先执行了降级(未绑定不卡死池的前提)
    expect(signalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ translationStatus: "pending" }),
        data: { translationStatus: "failed" },
      }),
    );
  });

  it("逐条翻译并汇总 done/cached/failed", async () => {
    signalFindMany.mockResolvedValue([{ id: BigInt(1) }, { id: BigInt(2) }, { id: BigInt(3) }]);
    signalFindFirst
      .mockResolvedValueOnce({ id: BigInt(1), rawText: "a", lang: "en" })
      .mockResolvedValueOnce({ id: BigInt(2), rawText: "b", lang: "en" })
      .mockResolvedValueOnce(null); // 第三条已被并发处理 → skipped
    redisGet.mockResolvedValueOnce(null).mockResolvedValueOnce("缓存命中");
    const r = await runInsightTranslateBatch();
    expect(r).toMatchObject({ pending: 3, done: 1, cached: 1, skipped: 1, unbound: false });
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ event: "insight.translate_batch" }),
    );
  });

  it("无 pending → 空汇总零模型调用", async () => {
    const r = await runInsightTranslateBatch();
    expect(r).toEqual({
      pending: 0,
      done: 0,
      cached: 0,
      failed: 0,
      skipped: 0,
      unbound: false,
    });
    expect(resolveModel).not.toHaveBeenCalled();
  });
});
