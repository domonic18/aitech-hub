/**
 * admin-sessions 单测(prisma/redis/checkpointer 必 mock):两源合并视图
 * (member 行 + 游客留档行 ∪ 台账聚合)、kind 过滤、内存分页、游客活跃态只查
 * 当前页、非 g_ 前缀聚合行防御性剔除;详情(member/guest 活跃/归属键消失但
 * 内容留档/内容已清退/仅剩留档行/404)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  searchAgentSession: { findMany: vi.fn(), findUnique: vi.fn() },
  aiUsageLog: { groupBy: vi.fn() },
}));
const existsMock = vi.hoisted(() => vi.fn());
const getThreadMessagesMock = vi.hoisted(() => vi.fn());
const getGuestThreadOwnerMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../redis", () => ({ redis: { exists: existsMock } }));
vi.mock("./checkpointer", () => ({ getThreadMessages: getThreadMessagesMock }));
vi.mock("./guest-threads", () => ({
  guestThreadKey: (id: string) => `search:agent:gthread:${id}`,
  isGuestThreadId: (id: string) => id.startsWith("g_"),
  getGuestThreadOwner: getGuestThreadOwnerMock,
}));
vi.mock("../logger", () => ({ logger: loggerMock }));

import { getAgentSessionDetail, listAgentSessionsAdmin } from "./admin-sessions";

const MEMBER_ROW = {
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  visitorId: "admin:user-1",
  title: "RAG 检索优化",
  tokensTotal: 900,
  createdAt: new Date("2026-10-06T02:00:00Z"),
  lastMessageAt: new Date("2026-10-06T03:00:00Z"),
};

beforeEach(() => {
  prismaMock.searchAgentSession.findMany.mockReset().mockResolvedValue([]);
  prismaMock.searchAgentSession.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.aiUsageLog.groupBy.mockReset().mockResolvedValue([]);
  existsMock.mockReset().mockResolvedValue(false);
  getThreadMessagesMock.mockReset().mockResolvedValue(null);
  getGuestThreadOwnerMock.mockReset().mockResolvedValue(null);
  loggerMock.warn.mockReset();
});

/** groupBy mock:按 where 形状分流(member in 集合 / guest startsWith / equals) */
function mockGroupBy(handlers: {
  guest?: Array<Record<string, unknown>>;
  byIds?: Array<Record<string, unknown>>;
}) {
  prismaMock.aiUsageLog.groupBy.mockImplementation(async ({ where }) => {
    const w = where as { sessionId?: Record<string, unknown> };
    if (w.sessionId && "startsWith" in w.sessionId) return handlers.guest ?? [];
    return handlers.byIds ?? [];
  });
}

/** findMany mock:成员查询(where.NOT)与游客留档行查询(where.id.startsWith)分流 */
function mockSessionFindMany(handlers: {
  member?: Array<Record<string, unknown>>;
  guest?: Array<Record<string, unknown>>;
}) {
  prismaMock.searchAgentSession.findMany.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) => {
      const id = where.id as { startsWith?: string } | undefined;
      return (id?.startsWith === "g_" ? handlers.guest : handlers.member) ?? [];
    },
  );
}

describe("listAgentSessionsAdmin", () => {
  it("两源合并按最近活动倒排,counts/分页正确", async () => {
    mockSessionFindMany({ member: [MEMBER_ROW] });
    mockGroupBy({
      guest: [
        {
          sessionId: "g_aaaa-1",
          _count: { _all: 2 },
          _sum: { tokensIn: 100, tokensOut: 200 },
          _min: { createdAt: new Date("2026-10-07T01:00:00Z") },
          _max: { createdAt: new Date("2026-10-07T02:00:00Z") },
        },
      ],
      byIds: [
        {
          sessionId: MEMBER_ROW.id,
          _count: { _all: 3 },
          _sum: { tokensIn: 400, tokensOut: 500 },
          _min: { createdAt: MEMBER_ROW.createdAt },
          _max: { createdAt: MEMBER_ROW.lastMessageAt },
        },
      ],
    });
    const r = await listAgentSessionsAdmin({ page: 1, kind: "all" });
    expect(r.total).toBe(2);
    expect(r.counts).toEqual({ all: 2, member: 1, guest: 1 });
    // 游客 lastAt=10-07T02:00Z 晚于成员 10-06T03:00Z → 游客在前
    expect(r.items[0].kind).toBe("guest");
    expect(r.items[0]).toMatchObject({
      threadId: "g_aaaa-1",
      runs: 2,
      tokensTotal: 300,
      live: false,
    });
    expect(r.items[1].kind).toBe("member");
    expect(r.items[1].runs).toBe(3);
    expect(r.items[1].tokensTotal).toBe(900); // tokens 以会话行累计为准
    expect(existsMock).toHaveBeenCalledTimes(1); // 活跃态只查当前页游客
    expect(existsMock).toHaveBeenCalledWith("search:agent:gthread:g_aaaa-1");
  });

  it("kind=guest 只查游客留档行,不查成员行;q 过滤游客线程 id", async () => {
    mockGroupBy({
      guest: [
        {
          sessionId: "g_aaaa-1",
          _count: { _all: 1 },
          _sum: { tokensIn: 10, tokensOut: 20 },
          _min: { createdAt: new Date("2026-10-07T01:00:00Z") },
          _max: { createdAt: new Date("2026-10-07T01:10:00Z") },
        },
        {
          sessionId: "g_bbbb-2",
          _count: { _all: 1 },
          _sum: { tokensIn: 1, tokensOut: 2 },
          _min: { createdAt: new Date("2026-10-07T02:00:00Z") },
          _max: { createdAt: new Date("2026-10-07T02:10:00Z") },
        },
      ],
    });
    const r = await listAgentSessionsAdmin({ page: 1, kind: "guest", q: "aaaa" });
    // 游客视图:唯一一次 findMany 是 g_ 前缀行查询(成员行一次都不查)
    expect(prismaMock.searchAgentSession.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.searchAgentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { startsWith: "g_" } }) }),
    );
    expect(r.counts).toEqual({ all: 1, member: 0, guest: 1 });
    expect(r.items[0].threadId).toBe("g_aaaa-1");
  });

  it("游客留档行:标题/tokens/时间以行为准,无行的历史线程仍按台账还原", async () => {
    mockSessionFindMany({
      guest: [
        {
          id: "g_aaaa-1",
          title: "怎么用 RAG 做知识库",
          tokensTotal: 999,
          createdAt: new Date("2026-10-07T00:50:00Z"),
          lastMessageAt: new Date("2026-10-07T01:30:00Z"),
        },
      ],
    });
    mockGroupBy({
      guest: [
        {
          sessionId: "g_aaaa-1",
          _count: { _all: 2 },
          _sum: { tokensIn: 100, tokensOut: 200 },
          _min: { createdAt: new Date("2026-10-07T01:00:00Z") },
          _max: { createdAt: new Date("2026-10-07T01:10:00Z") },
        },
        {
          sessionId: "g_legacy-2",
          _count: { _all: 1 },
          _sum: { tokensIn: 7, tokensOut: 8 },
          _min: { createdAt: new Date("2026-10-06T01:00:00Z") },
          _max: { createdAt: new Date("2026-10-06T01:10:00Z") },
        },
      ],
    });
    const r = await listAgentSessionsAdmin({ page: 1, kind: "guest" });
    expect(r.counts).toEqual({ all: 2, member: 0, guest: 2 });
    const byId = new Map(r.items.map((i) => [i.threadId, i]));
    expect(byId.get("g_aaaa-1")).toMatchObject({
      title: "怎么用 RAG 做知识库",
      tokensTotal: 999,
      runs: 2,
      live: false,
    });
    expect(byId.get("g_legacy-2")).toMatchObject({ title: null, tokensTotal: 15, runs: 1 });
  });

  it("非 g_ 前缀聚合行防御性剔除;成员行活跃态不查 Redis", async () => {
    mockSessionFindMany({ member: [MEMBER_ROW] });
    mockGroupBy({
      guest: [
        {
          sessionId: "not-guest",
          _count: { _all: 1 },
          _sum: { tokensIn: 1, tokensOut: 1 },
          _min: { createdAt: new Date() },
          _max: { createdAt: new Date() },
        },
      ],
      byIds: [],
    });
    const r = await listAgentSessionsAdmin({ page: 1, kind: "all" });
    expect(r.counts).toEqual({ all: 1, member: 1, guest: 0 });
    expect(existsMock).not.toHaveBeenCalled();
  });
});

describe("getAgentSessionDetail", () => {
  it("member:行 + runs 计数 + checkpoint 时间线", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue(MEMBER_ROW);
    mockGroupBy({
      byIds: [
        {
          sessionId: MEMBER_ROW.id,
          _count: { _all: 4 },
          _sum: { tokensIn: 400, tokensOut: 500 },
          _min: { createdAt: MEMBER_ROW.createdAt },
          _max: { createdAt: MEMBER_ROW.lastMessageAt },
        },
      ],
    });
    getThreadMessagesMock.mockResolvedValue([
      { getType: () => "human", content: "你好" },
      { getType: () => "ai", content: "你好!", id: "m-1" },
    ]);
    const d = await getAgentSessionDetail(MEMBER_ROW.id);
    expect(d).not.toBeNull();
    expect(d!.meta).toMatchObject({ kind: "member", title: "RAG 检索优化", runs: 4 });
    expect(d!.expired).toBe(false);
    expect(d!.messages).toEqual([
      { type: "human", content: "你好" },
      { type: "ai", content: "你好!", id: "m-1" },
    ]);
  });

  it("guest 活跃:归属键在场 + 时间线可读", async () => {
    mockGroupBy({
      guest: [
        {
          sessionId: "g_live-1",
          _count: { _all: 2 },
          _sum: { tokensIn: 30, tokensOut: 40 },
          _min: { createdAt: new Date("2026-10-07T01:00:00Z") },
          _max: { createdAt: new Date("2026-10-07T01:20:00Z") },
        },
      ],
    });
    getGuestThreadOwnerMock.mockResolvedValue("visitor-xyz");
    getThreadMessagesMock.mockResolvedValue([{ getType: () => "human", content: "hi" }]);
    const d = await getAgentSessionDetail("g_live-1");
    expect(d).not.toBeNull();
    expect(d!.meta).toMatchObject({ kind: "guest", owner: "visitor-xyz", live: true, runs: 2 });
    expect(d!.expired).toBe(false);
    expect(d!.messages).toHaveLength(1);
  });

  it("guest 归属键消失:留档行仍在 → 内容可读,仅 live=false", async () => {
    mockGroupBy({
      guest: [
        {
          sessionId: "g_dead-1",
          _count: { _all: 3 },
          _sum: { tokensIn: 1, tokensOut: 1 },
          _min: { createdAt: new Date("2026-10-01T00:00:00Z") },
          _max: { createdAt: new Date("2026-10-01T01:00:00Z") },
        },
      ],
    });
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({
      title: "留档标题",
      tokensTotal: 88,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      lastMessageAt: new Date("2026-10-01T01:00:00Z"),
    });
    getGuestThreadOwnerMock.mockResolvedValue(null);
    getThreadMessagesMock.mockResolvedValue([{ getType: () => "human", content: "旧问题" }]);
    const d = await getAgentSessionDetail("g_dead-1");
    expect(d).not.toBeNull();
    expect(d!.meta).toMatchObject({
      kind: "guest",
      title: "留档标题",
      tokensTotal: 88,
      live: false,
      runs: 3,
    });
    expect(d!.expired).toBe(false);
    expect(d!.messages).toHaveLength(1);
  });

  it("guest 内容已被清退(checkpoint 缺失):expired=true messages=null", async () => {
    mockGroupBy({
      guest: [
        {
          sessionId: "g_gone-1",
          _count: { _all: 2 },
          _sum: { tokensIn: 1, tokensOut: 1 },
          _min: { createdAt: new Date("2026-09-01T00:00:00Z") },
          _max: { createdAt: new Date("2026-09-01T01:00:00Z") },
        },
      ],
    });
    getGuestThreadOwnerMock.mockResolvedValue(null);
    getThreadMessagesMock.mockResolvedValue(null);
    const d = await getAgentSessionDetail("g_gone-1");
    expect(d!.expired).toBe(true);
    expect(d!.messages).toBeNull();
    expect(getThreadMessagesMock).toHaveBeenCalledWith("g_gone-1");
  });

  it("台账无行且归属键不在 → 404(null);member 行缺失 → null", async () => {
    expect(await getAgentSessionDetail("g_none-1")).toBeNull();
    expect(await getAgentSessionDetail("missing-id")).toBeNull();
  });

  it("仅留档行(台账无行/归属键消失)仍有痕迹 → 不 404", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({
      title: "只剩行",
      tokensTotal: 12,
      createdAt: new Date("2026-10-02T00:00:00Z"),
      lastMessageAt: new Date("2026-10-02T01:00:00Z"),
    });
    getThreadMessagesMock.mockResolvedValue(null);
    const d = await getAgentSessionDetail("g_rowonly-1");
    expect(d).not.toBeNull();
    expect(d!.meta).toMatchObject({ title: "只剩行", tokensTotal: 12, runs: 0, live: false });
    expect(d!.expired).toBe(true);
  });

  it("member checkpoint 缺失:warn + expired=true", async () => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue(MEMBER_ROW);
    getThreadMessagesMock.mockResolvedValue(null);
    const d = await getAgentSessionDetail(MEMBER_ROW.id);
    expect(d!.expired).toBe(true);
    expect(d!.messages).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.admin_session_checkpoint_missing" }),
    );
  });
});
