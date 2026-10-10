/**
 * identity 三路分流单测(M22 批④):admin/user(ah_at role 区分,均走
 * 会话行路径)/ 游客(ah_av)。verifyAccessToken/visitor 必 mock(模块级
 * 副作用:Redis/NextRequest 依赖)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  ACCESS_COOKIE_NAME: "ah_at",
}));
const visitorMock = vi.hoisted(() => ({
  resolveVisitorId: vi.fn(),
  attachVisitorCookie: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => sessionMock);
vi.mock("@/lib/auth/constants", () => ({ ADMIN_ROLE: "admin" }));
vi.mock("./visitor", () => visitorMock);

import { isMemberIdentity, resolveAgentIdentity } from "./identity";

const req = { cookies: { get: () => undefined } } as never;

beforeEach(() => {
  sessionMock.verifyAccessToken.mockReset();
  visitorMock.resolveVisitorId.mockReset();
});

describe("resolveAgentIdentity(M22 三路)", () => {
  it("role=admin → admin 路,visitorId 锚 admin:<sub>", async () => {
    sessionMock.verifyAccessToken.mockResolvedValue({ sub: "1", role: "admin" });
    const id = await resolveAgentIdentity(req);
    expect(id).toEqual({ kind: "admin", key: "admin:1" });
    expect(visitorMock.resolveVisitorId).not.toHaveBeenCalled();
  });

  it("role=user → user 路(M22 起普通用户不再是游客),key=user:<sub> 且带 userId", async () => {
    sessionMock.verifyAccessToken.mockResolvedValue({ sub: "42", role: "user" });
    const id = await resolveAgentIdentity(req);
    expect(id).toEqual({ kind: "user", key: "user:42", userId: BigInt(42) });
    expect(visitorMock.resolveVisitorId).not.toHaveBeenCalled();
  });

  it("无 token → 游客(ah_av id + fresh 透传)", async () => {
    sessionMock.verifyAccessToken.mockResolvedValue(null);
    visitorMock.resolveVisitorId.mockReturnValue({ id: "v-abc", fresh: true });
    const id = await resolveAgentIdentity(req);
    expect(id).toEqual({ kind: "guest", key: "v-abc", fresh: true });
  });

  it("isMemberIdentity:admin/user 走会话行路径,游客否", () => {
    expect(isMemberIdentity({ kind: "admin", key: "admin:1" })).toBe(true);
    expect(isMemberIdentity({ kind: "user", key: "user:2", userId: BigInt(2) })).toBe(true);
    expect(isMemberIdentity({ kind: "guest", key: "v", fresh: false })).toBe(false);
  });
});
