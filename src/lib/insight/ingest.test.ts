/** 洞察信号入池单测(prisma mock,无真库):源→介质映射/归一与截断/
 * 空文本拒收/P2002 幂等跳过/异常自吞不外抛。 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  logger: { warn: (...a: unknown[]) => loggerWarn(...a), info: vi.fn() },
}));

const signalCreate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { insightSignal: { create: (...a: unknown[]) => signalCreate(...a) } },
}));

import { INSIGHT_SOURCE_MEDIUM, ingestInsightSignal } from "./ingest";

beforeEach(() => {
  vi.clearAllMocks();
  signalCreate.mockResolvedValue({ id: BigInt(1) });
});

describe("ingestInsightSignal", () => {
  it("正常入池:源→介质映射、归一(trim+空白折叠)、meta 透传", async () => {
    const r = await ingestInsightSignal({
      source: "internal-search",
      refId: "42",
      rawText: "  怎么用  AI 做\n\tPPT  ",
      signalAt: new Date("2026-10-17T08:00:00+08:00"),
      meta: { hitCount: 0 },
    });
    expect(r).toBe("ingested");
    expect(signalCreate).toHaveBeenCalledWith({
      data: {
        source: "internal-search",
        medium: "search",
        refId: "42",
        rawText: "怎么用  AI 做\n\tPPT",
        normalizedText: "怎么用 AI 做 PPT",
        meta: { hitCount: 0 },
        signalAt: new Date("2026-10-17T08:00:00+08:00"),
      },
      select: { id: true },
    });
  });

  it("五源介质映射各就位(方案 §2:搜索问句=search,评论反馈=voice,电报AI=ai-record)", async () => {
    for (const [source, medium] of Object.entries(INSIGHT_SOURCE_MEDIUM)) {
      await ingestInsightSignal({
        source: source as keyof typeof INSIGHT_SOURCE_MEDIUM,
        refId: "x",
        rawText: "内容",
        signalAt: new Date(0),
      });
      expect(signalCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ medium }) }),
      );
    }
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
      source: "internal-feedback",
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
      source: "internal-agent",
      refId: "sess-1",
      rawText: "问句",
      signalAt: new Date(0),
    });
    expect(r).toBe("duplicate");
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
