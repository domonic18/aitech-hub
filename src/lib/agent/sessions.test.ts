/**
 * sessions 单测(prisma/redis/ingest 必 mock):标题派生(首行 20 码点/空回落)、
 * 删除归属校验(checkpoint 删失败不反噬)、touch tokens 累计、标题仅空行回填;
 * M58 批⑤ 问句入池:后台功能页上下文过滤、meta.surface、游客 Redis NX 判首问
 * (OK 才入池;null/异常跳过);游客匿名会话行留档(落行/补标题/失败告警)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  searchAgentSession: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}));
const deleteThreadMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const ingestMock = vi.hoisted(() => vi.fn());
const redisMock = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("./checkpointer", () => ({ deleteThread: deleteThreadMock }));
vi.mock("../logger", () => ({ logger: loggerMock }));
vi.mock("../insight/ingest", () => ({ ingestInsightSignal: ingestMock }));
vi.mock("../redis", () => ({ redis: redisMock }));

import {
  backfillSessionTitle,
  createSession,
  deleteSession,
  deriveTitle,
  recordGuestFirstAsk,
  touchGuestSessionAfterRun,
  touchSessionAfterRun,
} from "./sessions";

beforeEach(() => {
  for (const m of Object.values(prismaMock.searchAgentSession)) m.mockReset();
  deleteThreadMock.mockReset();
  deleteThreadMock.mockResolvedValue(undefined);
  ingestMock.mockReset();
  ingestMock.mockResolvedValue("ingested");
  redisMock.set.mockReset();
  loggerMock.warn.mockReset();
});

describe("deriveTitle", () => {
  it("首行前 20 码点(汉字无截半问题)", () => {
    expect(deriveTitle("这是一个超过二十个汉字的标题用来验证码点截断行为正确")).toBe(
      "这是一个超过二十个汉字的标题用来验证码点",
    );
  });
  it("多行取首行(trim 吃前导空行);全空白回落「新会话」", () => {
    expect(deriveTitle("第一行\n第二行")).toBe("第一行");
    expect(deriveTitle("  \n\n正文")).toBe("正文");
    expect(deriveTitle("")).toBe("新会话");
    expect(deriveTitle("   \n  ")).toBe("新会话");
  });
});

describe("deleteSession", () => {
  it("归属校验通过:行+checkpoint 同删", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "v-1" });
    prismaMock.searchAgentSession.delete.mockResolvedValue({});
    await expect(deleteSession("v-1", "t-1")).resolves.toBe(true);
    expect(prismaMock.searchAgentSession.delete).toHaveBeenCalledWith({ where: { id: "t-1" } });
    expect(deleteThreadMock).toHaveBeenCalledWith("t-1");
  });

  it("非本人/不存在 → false 且不触删(404 不泄露存在性)", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "other" });
    await expect(deleteSession("v-1", "t-1")).resolves.toBe(false);
    prismaMock.searchAgentSession.findUnique.mockResolvedValue(null);
    await expect(deleteSession("v-1", "t-2")).resolves.toBe(false);
    expect(prismaMock.searchAgentSession.delete).not.toHaveBeenCalled();
    expect(deleteThreadMock).not.toHaveBeenCalled();
  });

  it("checkpoint 删失败:行已删返 true,只告警(30 天日清兜底)", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({ visitorId: "v-1" });
    prismaMock.searchAgentSession.delete.mockResolvedValue({});
    deleteThreadMock.mockRejectedValue(new Error("cp down"));
    await expect(deleteSession("v-1", "t-1")).resolves.toBe(true);
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});

describe("createSession/touch/backfill", () => {
  it("create 用 uuid 建行", async () => {
    prismaMock.searchAgentSession.create.mockResolvedValue({});
    const { id } = await createSession("v-1");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(prismaMock.searchAgentSession.create).toHaveBeenCalledWith({
      data: { id, visitorId: "v-1" },
    });
  });

  it("touch:tokens 正数累计", async () => {
    prismaMock.searchAgentSession.update.mockResolvedValue({});
    await touchSessionAfterRun("t-1", 320);
    expect(prismaMock.searchAgentSession.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: expect.objectContaining({ tokensTotal: { increment: 320 } }),
    });
  });

  it("backfill 仅回填 title 为空的行(updateMany 条件)", async () => {
    prismaMock.searchAgentSession.updateMany.mockResolvedValue({ count: 1 });
    await backfillSessionTitle("t-1", "问个问题");
    expect(prismaMock.searchAgentSession.updateMany).toHaveBeenCalledWith({
      where: { id: "t-1", title: null },
      data: { title: "问个问题" },
    });
  });
});

describe("问句入池(M58 批⑤,arch/01 §3.4)", () => {
  it("首问回填命中:公开页放行,meta.surface 记入口", async () => {
    prismaMock.searchAgentSession.updateMany.mockResolvedValue({ count: 1 });
    await backfillSessionTitle("t-1", "怎么用 Claude Code 做爬虫", "搜索");
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "internal-agent",
        refId: "t-1",
        rawText: "怎么用 Claude Code 做爬虫",
        meta: { surface: "搜索" },
      }),
    );
  });

  it("后台功能页上下文:不入池(黑名单按页名,与身份无关)", async () => {
    prismaMock.searchAgentSession.updateMany.mockResolvedValue({ count: 1 });
    for (const page of ["后台", "文章新建", "文章编辑", "文章管理", "创作中心"]) {
      await backfillSessionTitle("t-1", "改一下标题", page);
    }
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("非首问(标题已填)与无上下文:都不入池(fail-closed)", async () => {
    prismaMock.searchAgentSession.updateMany.mockResolvedValue({ count: 0 });
    await backfillSessionTitle("t-1", "第二个问题", "搜索");
    expect(ingestMock).not.toHaveBeenCalled();

    // 无页面上下文无法判定前台/后台(编辑器/创作中心旧客户端),一律不收
    prismaMock.searchAgentSession.updateMany.mockResolvedValue({ count: 1 });
    await backfillSessionTitle("t-2", "直接站内提问");
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("游客首问:NX 抢到才入池,refId 加 g: 前缀且不存 visitorId", async () => {
    redisMock.set.mockResolvedValue("OK");
    await recordGuestFirstAsk("g_t1", "有没有讲 RAG 的文章", "首页");
    expect(redisMock.set).toHaveBeenCalledWith(
      "search:agent:ask-recorded:g_t1",
      "1",
      "EX",
      21600,
      "NX",
    );
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "internal-agent",
        refId: "g:g_t1",
        rawText: "有没有讲 RAG 的文章",
        meta: { surface: "首页" },
      }),
    );
    const arg = ingestMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("visitorId");
  });

  it("游客非首问(NX 未抢到)与后台页:跳过", async () => {
    redisMock.set.mockResolvedValue(null);
    await recordGuestFirstAsk("g_t1", "再问一次", "搜索");
    expect(ingestMock).not.toHaveBeenCalled();

    redisMock.set.mockResolvedValue("OK");
    await recordGuestFirstAsk("g_t2", "后台里问一句", "后台");
    expect(ingestMock).not.toHaveBeenCalled();

    await recordGuestFirstAsk("g_t3", "无上下文提问");
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("Redis 不可用:告警并跳过(宁可漏记不误记)", async () => {
    redisMock.set.mockRejectedValue(new Error("redis down"));
    await recordGuestFirstAsk("g_t1", "问句", "搜索");
    expect(ingestMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.guest_ask_record_failed", threadId: "g_t1" }),
    );
  });
});

describe("游客匿名会话行留档(M58 批⑤ 后续)", () => {
  it("首问落匿名行:visitorId=guest(不存访客标识),标题派生,tokens 累计", async () => {
    prismaMock.searchAgentSession.upsert.mockResolvedValue({});
    prismaMock.searchAgentSession.updateMany.mockResolvedValue({ count: 0 });
    await touchGuestSessionAfterRun("g_t1", "怎么用 RAG 做知识库", 30);
    expect(prismaMock.searchAgentSession.upsert).toHaveBeenCalledWith({
      where: { id: "g_t1" },
      create: {
        id: "g_t1",
        visitorId: "guest",
        title: "怎么用 RAG 做知识库",
        lastMessageAt: expect.any(Date),
        tokensTotal: 30,
      },
      update: { lastMessageAt: expect.any(Date), tokensTotal: { increment: 30 } },
    });
    expect(prismaMock.searchAgentSession.updateMany).toHaveBeenCalledWith({
      where: { id: "g_t1", title: null },
      data: { title: "怎么用 RAG 做知识库" },
    });
  });

  it("resume(无新消息):只 touch,不写标题(建行标题为 null)", async () => {
    prismaMock.searchAgentSession.upsert.mockResolvedValue({});
    await touchGuestSessionAfterRun("g_t1", null, 5);
    expect(prismaMock.searchAgentSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ title: null, tokensTotal: 5 }),
        update: expect.objectContaining({ tokensTotal: { increment: 5 } }),
      }),
    );
    expect(prismaMock.searchAgentSession.updateMany).not.toHaveBeenCalled();
  });

  it("建行失败只告警,不反噬 run", async () => {
    prismaMock.searchAgentSession.upsert.mockRejectedValue(new Error("db down"));
    await expect(touchGuestSessionAfterRun("g_t1", "问句", 3)).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.guest_session_touch_failed", threadId: "g_t1" }),
    );
  });
});
