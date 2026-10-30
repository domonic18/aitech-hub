/** 洞察信号入池单测(prisma mock,无真库):在役源闸门/源→介质映射/归一与
 * 截断/空文本拒收/P2002 幂等与热榜 meta 刷新/异常自吞不外抛。 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  logger: { warn: (...a: unknown[]) => loggerWarn(...a), info: vi.fn() },
}));

const signalCreate = vi.fn();
const signalUpdateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    insightSignal: {
      create: (...a: unknown[]) => signalCreate(...a),
      updateMany: (...a: unknown[]) => signalUpdateMany(...a),
    },
  },
}));

const queueAdd = vi.fn();
vi.mock("@/lib/queue", () => ({
  QUEUE_INSIGHT: "insight",
  INSIGHT_JOB_TRANSLATE: "translate",
  getQueue: () => ({ add: (...a: unknown[]) => queueAdd(...a) }),
}));

import { INSIGHT_SOURCES_ENABLED, INSIGHT_SOURCE_MEDIUM, ingestInsightSignal } from "./ingest";

beforeEach(() => {
  vi.clearAllMocks();
  signalCreate.mockResolvedValue({ id: BigInt(1) });
  signalUpdateMany.mockResolvedValue({ count: 1 });
  queueAdd.mockResolvedValue({ id: "insight-translate-1" });
});

describe("ingestInsightSignal", () => {
  it("正常入池:源→介质映射、归一(trim+空白折叠)、meta 透传", async () => {
    const r = await ingestInsightSignal({
      source: "internal-comment",
      refId: "42",
      rawText: "  怎么用  AI 做\n\tPPT  ",
      signalAt: new Date("2026-10-17T08:00:00+08:00"),
      meta: { foo: 1 },
    });
    expect(r).toBe("ingested");
    expect(signalCreate).toHaveBeenCalledWith({
      data: {
        source: "internal-comment",
        medium: "voice",
        lang: "zh",
        region: "cn",
        refId: "42",
        rawText: "怎么用  AI 做\n\tPPT",
        normalizedText: "怎么用 AI 做 PPT",
        translationStatus: "none",
        domain: "unclassified",
        meta: { foo: 1 },
        signalAt: new Date("2026-10-17T08:00:00+08:00"),
      },
      select: { id: true },
    });
    // 中文源零翻译开销:不入翻译队列
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("非中文源(M58):逐条 lang 覆盖 → pending + 入翻译队列(单条 job)", async () => {
    const r = await ingestInsightSignal({
      source: "internal-comment",
      refId: "en-1",
      rawText: "How to use Claude Code",
      signalAt: new Date(0),
      lang: "en",
      region: "global",
    });
    expect(r).toBe("ingested");
    expect(signalCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lang: "en",
          region: "global",
          translationStatus: "pending",
        }),
      }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "translate",
      { signalId: "1" },
      expect.objectContaining({ jobId: "insight-translate-1", attempts: 1, removeOnFail: true }),
    );
  });

  it("翻译入队失败不影响入池(Redis 抖动,扫尾 cron 兜底)", async () => {
    queueAdd.mockRejectedValueOnce(new Error("redis down"));
    const r = await ingestInsightSignal({
      source: "internal-comment",
      refId: "en-2",
      rawText: "Hello world",
      signalAt: new Date(0),
      lang: "en",
    });
    expect(r).toBe("ingested");
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "insight.translate_enqueue_failed" }),
    );
  });

  it("在役源逐一映射介质(评论/电报AI/热榜三源/厂商六源/社区四源;方案 §2 五介质口径)", async () => {
    expect([...INSIGHT_SOURCES_ENABLED].sort()).toEqual([
      "community-baidu",
      "community-hn",
      "community-oss",
      "community-v2ex",
      "hot-baidu",
      "hot-bilibili",
      "hot-zhihu",
      "internal-comment",
      "telegram-ai",
      "vendor-anthropic",
      "vendor-deepseek",
      "vendor-google",
      "vendor-kimi",
      "vendor-openai",
      "vendor-qwen",
    ]);
    for (const [source, medium] of Object.entries(INSIGHT_SOURCE_MEDIUM)) {
      await ingestInsightSignal({
        source: source as keyof typeof INSIGHT_SOURCE_MEDIUM,
        refId: "x",
        rawText: "内容",
        signalAt: new Date(0),
      });
      if (INSIGHT_SOURCES_ENABLED.has(source as keyof typeof INSIGHT_SOURCE_MEDIUM)) {
        expect(signalCreate).toHaveBeenLastCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ medium }) }),
        );
      }
    }
  });

  it("停接源短路返 disabled,零写入零日志(批③ 渠道转向闸)", async () => {
    for (const source of ["internal-search", "internal-agent", "internal-feedback"] as const) {
      const r = await ingestInsightSignal({
        source,
        refId: "1",
        rawText: "词",
        signalAt: new Date(0),
      });
      expect(r).toBe("disabled");
    }
    expect(signalCreate).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("raw 截 4000、归一截 2000、refId 截 120", async () => {
    await ingestInsightSignal({
      source: "internal-comment",
      refId: "r".repeat(200),
      rawText: "评".repeat(5000),
      signalAt: new Date(0),
    });
    const data = signalCreate.mock.calls[0][0].data as {
      refId: string;
      rawText: string;
      normalizedText: string;
    };
    expect(data.rawText.length).toBe(4000);
    expect(data.normalizedText.length).toBe(2000);
    expect(data.refId.length).toBe(120);
  });

  it("空文本(纯空白)不入池返 error,零日志噪音", async () => {
    const r = await ingestInsightSignal({
      source: "telegram-ai",
      refId: "1",
      rawText: "   ",
      signalAt: new Date(0),
    });
    expect(r).toBe("error");
    expect(signalCreate).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("(source, refId) 撞唯一 → duplicate(P2002 幂等,回填与实时并发安全)", async () => {
    signalCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const r = await ingestInsightSignal({
      source: "internal-comment",
      refId: "sess-1",
      rawText: "问句",
      signalAt: new Date(0),
    });
    expect(r).toBe("duplicate");
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("refreshMeta 开启时撞唯一 → 刷新 meta 与 signal_at 返 refreshed(热榜仍在榜)", async () => {
    signalCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const meta = { rank: 3, batch: 1792302900000 };
    const at = new Date("2026-10-18T07:43:00+08:00");
    const r = await ingestInsightSignal(
      { source: "hot-baidu", refId: "某热点词", rawText: "某热点词", signalAt: at, meta },
      { refreshMeta: true },
    );
    expect(r).toBe("refreshed");
    expect(signalUpdateMany).toHaveBeenCalledWith({
      where: { source: "hot-baidu", refId: "某热点词" },
      data: { meta, signalAt: at },
    });
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("其他异常自吞返 error 并告警,永不 reject(调用方 fire-and-forget 前提)", async () => {
    signalCreate.mockRejectedValue(new Error("connection refused"));
    const r = await ingestInsightSignal({
      source: "telegram-ai",
      refId: "9",
      rawText: "摘要",
      signalAt: new Date(0),
    });
    expect(r).toBe("error");
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "insight.ingest_failed", source: "telegram-ai" }),
    );
  });
});
