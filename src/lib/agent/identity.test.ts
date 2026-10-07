/**
 * identity 单测(jose/visitor 必 mock):admin 会话 → admin 身份;无/非 admin
 * 会话 → 游客(ah_av 透传 fresh);cookie 补发只在游客 fresh 时发生。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyMock = vi.hoisted(() => vi.fn());
const resolveVisitorMock = vi.hoisted(() => vi.fn());
const attachCookieMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({
  ACCESS_COOKIE_NAME: "ah_at",
  verifyAccessToken: verifyMock,
}));
vi.mock("@/lib/auth/constants", () => ({ ADMIN_ROLE: "admin" }));
vi.mock("./visitor", () => ({
  resolveVisitorId: resolveVisitorMock,
  attachVisitorCookie: attachCookieMock,
}));

import { attachIdentityCookie, resolveAgentIdentity } from "./identity";

function fakeReq(cookie?: string): never {
  return {
    cookies: { get: (n: string) => (n === "ah_at" && cookie ? { value: cookie } : undefined) },
  } as never;
}

beforeEach(() => {
  verifyMock.mockReset().mockResolvedValue(null);
  resolveVisitorMock.mockReset().mockReturnValue({ id: "v-1", fresh: false });
  attachCookieMock.mockReset();
});

describe("resolveAgentIdentity", () => {
  it("admin 会话 → admin 身份(key=admin:<sub>),不触 visitor", async () => {
    verifyMock.mockResolvedValue({ sub: "13800000000", role: "admin" });
    const identity = await resolveAgentIdentity(fakeReq("tok"));
    expect(identity).toEqual({ kind: "admin", key: "admin:13800000000" });
    expect(resolveVisitorMock).not.toHaveBeenCalled();
  });

  it("无会话 → 游客(visitor.id + fresh 透传)", async () => {
    resolveVisitorMock.mockReturnValue({ id: "v-9", fresh: true });
    const identity = await resolveAgentIdentity(fakeReq());
    expect(identity).toEqual({ kind: "guest", key: "v-9", fresh: true });
  });

  it("非 admin 角色(user)→ 游客", async () => {
    verifyMock.mockResolvedValue({ sub: "u-1", role: "user" });
    const identity = await resolveAgentIdentity(fakeReq("tok"));
    expect(identity.kind).toBe("guest");
  });

  it("attachIdentityCookie:仅游客 fresh 补发;admin 不动", () => {
    attachIdentityCookie({} as never, { kind: "guest", key: "v-1", fresh: true });
    expect(attachCookieMock).toHaveBeenCalledWith({}, "v-1");
    attachCookieMock.mockReset();
    attachIdentityCookie({} as never, { kind: "guest", key: "v-1", fresh: false });
    expect(attachCookieMock).not.toHaveBeenCalled();
    attachIdentityCookie({} as never, { kind: "admin", key: "admin:u" });
    expect(attachCookieMock).not.toHaveBeenCalled();
  });
});
