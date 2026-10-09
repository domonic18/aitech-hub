/**
 * stream 路由 user 余额链路单测(M22 批④):run 前 hasTokenBalance 预检
 * (≤0 → 429 且不进 run);run 后 consumeTokens 按实际用量实扣(user 专属,
 * admin/游客不扣);扣减失败只告警不反噬。重依赖(run/sessions/quota/prisma/
 * token-balance)全 mock,只验路由接线与护栏次序。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const identityMock = vi.hoisted(() => ({ resolveAgentIdentity: vi.fn() }));
const balanceMock = vi.hoisted(() => ({
  hasTokenBalance: vi.fn(),
  consumeTokens: vi.fn(),
}));
const runMock = vi.hoisted(() => ({
  AGENT_MAX_TOKENS: 50_000,
  runAgentTurn: vi.fn(),
  recordAgentRun: vi.fn(),
}));
const sessionsMock = vi.hoisted(() => ({ backfillSessionTitle: vi.fn() }));
const quotaMock = vi.hoisted(() => ({
  tryConsumeAgentRunQuota: vi.fn(),
  tryConsumeGuestAskQuota: vi.fn(),
}));
const prismaMock = vi.hoisted(() => ({
  searchAgentSession: { findUnique: vi.fn() },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/agent/identity", () => identityMock);
vi.mock("@/lib/users/token-balance", () => balanceMock);
vi.mock("@/lib/agent/run", () => runMock);
vi.mock("@/lib/agent/sessions", () => sessionsMock);
vi.mock("@/lib/agent/quota", () => quotaMock);
vi.mock("@/lib/agent/guest-threads", () => ({
  isGuestThreadId: (id: string) => id.startsWith("g_"),
  getGuestThreadOwner: vi.fn(),
  refreshGuestThread: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/http/origin", () => ({ isSameOrigin: () => true }));
vi.mock("@/lib/http/request", () => ({ clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

const { POST } = await import("@/app/api/search/agent/threads/[threadId]/runs/stream/route");

const USER = { kind: "user", key: "user:42", userId: BigInt(42) };
const TID = "t-abc";
const req = (body: unknown = { input: { messages: [{ type: "human", content: "hi" }] } }) =>
  new Request(`http://localhost:3000/api/search/agent/threads/${TID}/runs/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

beforeEach(() => {
  for (const m of [
    identityMock.resolveAgentIdentity,
    balanceMock.hasTokenBalance,
    balanceMock.consumeTokens,
    runMock.runAgentTurn,
    runMock.recordAgentRun,
    sessionsMock.backfillSessionTitle,
    quotaMock.tryConsumeAgentRunQuota,
    prismaMock.searchAgentSession.findUnique,
  ]) {
    m.mockReset();
  }
  quotaMock.tryConsumeAgentRunQuota.mockResolvedValue(true);
  prismaMock.searchAgentSession.findUnique.mockResolvedValue({
    visitorId: "user:42",
    tokensTotal: 0,
  });
  sessionsMock.backfillSessionTitle.mockResolvedValue(undefined);
  runMock.recordAgentRun.mockResolvedValue(undefined);
});

describe("user 余额链路(M22 批④)", () => {
  it("余额 ≤0:429 且不进 run(预检 fail-closed)", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue(USER);
    balanceMock.hasTokenBalance.mockResolvedValue(false);

    const res = await POST(req(), { params: Promise.resolve({ threadId: TID }) });
    expect(res.status).toBe(429);
    expect(runMock.runAgentTurn).not.toHaveBeenCalled();
    expect(balanceMock.consumeTokens).not.toHaveBeenCalled();
  });

  it("余额 >0:放行 run,run 后按实际 tokens 实扣并透传 userId 台账", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue(USER);
    balanceMock.hasTokenBalance.mockResolvedValue(true);
    balanceMock.consumeTokens.mockResolvedValue({ balance: 199_970, periodKey: "2026-10" });
    runMock.runAgentTurn.mockResolvedValue({
      tokensIn: 10,
      tokensOut: 20,
      toolCalls: 1,
      truncatedReason: null,
      resolved: null,
    });

    const res = await POST(req(), { params: Promise.resolve({ threadId: TID }) });
    expect(res.status).toBe(200);
    await res.text(); // 驱动 SSE 流到收尾,断言在流关闭前完成

    expect(runMock.runAgentTurn).toHaveBeenCalledTimes(1);
    expect(runMock.recordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: TID, userId: BigInt(42) }),
    );
    expect(balanceMock.consumeTokens).toHaveBeenCalledWith(BigInt(42), 30, TID);
    expect(sessionsMock.backfillSessionTitle).toHaveBeenCalledWith(TID, "hi");
  });

  it("admin:不预检不扣余额(免费额度制仅 user)", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue({ kind: "admin", key: "admin:1" });
    prismaMock.searchAgentSession.findUnique.mockResolvedValue({
      visitorId: "admin:1",
      tokensTotal: 0,
    });
    runMock.runAgentTurn.mockResolvedValue({
      tokensIn: 5,
      tokensOut: 5,
      toolCalls: 0,
      truncatedReason: null,
      resolved: null,
    });

    const res = await POST(req(), { params: Promise.resolve({ threadId: TID }) });
    await res.text();

    expect(balanceMock.hasTokenBalance).not.toHaveBeenCalled();
    expect(balanceMock.consumeTokens).not.toHaveBeenCalled();
    expect(runMock.recordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: TID, userId: undefined }),
    );
  });

  it("扣减失败只告警,不反噬已完成的 run(无 error 帧)", async () => {
    identityMock.resolveAgentIdentity.mockResolvedValue(USER);
    balanceMock.hasTokenBalance.mockResolvedValue(true);
    balanceMock.consumeTokens.mockRejectedValue(new Error("db down"));
    runMock.runAgentTurn.mockResolvedValue({
      tokensIn: 1,
      tokensOut: 1,
      toolCalls: 0,
      truncatedReason: null,
      resolved: null,
    });

    const res = await POST(req(), { params: Promise.resolve({ threadId: TID }) });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("event: error");
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "token_wallet.consume_failed" }),
    );
  });
});
