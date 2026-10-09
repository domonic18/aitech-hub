/**
 * threads 路由 user 路径单测(M22 批④):GET/POST 对登录用户与 admin 同构
 * (会话行按 visitorId 归属隔离——user:<sub> 只见自己的行),游客维持恒空/
 * Redis 线程。重模块(prisma/quota/guest-threads)全 mock,只验路由接线。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  searchAgentSession: { findMany: vi.fn(), create: vi.fn() },
}));
const sessionsMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
}));
const quotaMock = vi.hoisted(() => ({ tryConsumeSessionQuota: vi.fn() }));
const guestMock = vi.hoisted(() => ({
  bindGuestThread: vi.fn(),
  newGuestThreadId: vi.fn(() => "g_new"),
}));
const identityMock = vi.hoisted(() => ({
  resolveAgentIdentity: vi.fn(),
  attachIdentityCookie: vi.fn(),
  isMemberIdentity: (id: { kind: string }) => id.kind !== "guest",
}));

vi.mock("@/lib/db", () => prismaMock);
vi.mock("@/lib/agent/sessions", () => sessionsMock);
vi.mock("@/lib/agent/quota", () => quotaMock);
vi.mock("@/lib/agent/guest-threads", () => guestMock);
vi.mock("@/lib/agent/identity", () => identityMock);
vi.mock("@/lib/http/origin", () => ({ isSameOrigin: () => true }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET, POST } = await import("@/app/api/search/agent/threads/route");

const req = new Request("http://localhost:3000/api/search/agent/threads") as never;

beforeEach(() => {
  for (const m of [
    sessionsMock.listSessions,
    sessionsMock.createSession,
    quotaMock.tryConsumeSessionQuota,
    guestMock.bindGuestThread,
    identityMock.attachIdentityCookie,
  ]) {
    m.mockReset();
  }
  quotaMock.tryConsumeSessionQuota.mockResolvedValue(true);
  guestMock.newGuestThreadId.mockReturnValue("g_new");
});

describe("GET /api/search/agent/threads", () => {
  it("user 身份:按 user:<sub> 锚列自己的会话(归属隔离)", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue({
      kind: "user",
      key: "user:42",
      userId: BigInt(42),
    });
    sessionsMock.listSessions.mockResolvedValue([{ id: "t1" }]);
    const res = await GET(req);
    const body = (await res.json()) as { code: number; data: unknown[] };
    expect(sessionsMock.listSessions).toHaveBeenCalledWith("user:42");
    expect(body.data).toHaveLength(1);
  });

  it("游客:恒空列表,不触会话行", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue({
      kind: "guest",
      key: "v-1",
      fresh: false,
    });
    const res = await GET(req);
    const body = (await res.json()) as { code: number; data: unknown[] };
    expect(body.data).toEqual([]);
    expect(sessionsMock.listSessions).not.toHaveBeenCalled();
  });
});

describe("POST /api/search/agent/threads", () => {
  it("user 身份:配额锚 user:<sub>,建行同锚", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue({
      kind: "user",
      key: "user:42",
      userId: BigInt(42),
    });
    sessionsMock.createSession.mockResolvedValue({ id: "t9" });
    const res = await POST(req);
    const body = (await res.json()) as { data: { threadId: string } };
    expect(quotaMock.tryConsumeSessionQuota).toHaveBeenCalledWith("user:42");
    expect(sessionsMock.createSession).toHaveBeenCalledWith("user:42");
    expect(body.data.threadId).toBe("t9");
    expect(guestMock.bindGuestThread).not.toHaveBeenCalled();
  });

  it("配额超限 429,不建行", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue({
      kind: "user",
      key: "user:42",
      userId: BigInt(42),
    });
    quotaMock.tryConsumeSessionQuota.mockResolvedValue(false);
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(sessionsMock.createSession).not.toHaveBeenCalled();
  });

  it("游客:Redis 绑归属,零 DB 行", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue({
      kind: "guest",
      key: "v-1",
      fresh: true,
    });
    const res = await POST(req);
    const body = (await res.json()) as { data: { threadId: string } };
    expect(body.data.threadId).toBe("g_new");
    expect(guestMock.bindGuestThread).toHaveBeenCalledWith("g_new", "v-1");
    expect(sessionsMock.createSession).not.toHaveBeenCalled();
  });
});
