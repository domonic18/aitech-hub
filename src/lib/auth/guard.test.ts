/**
 * admin 守卫单测(arch/05-services §3.2):钉安全契约——
 * role!=="admin" 一律不放行;页面路径 redirect、端点路径返回 null 由调用方定 401。
 * 边界 mock:issuer(会话校验)、next/headers(cookies)、next/navigation(redirect 抛出)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/issuer", () => ({ readFullSessionUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { cookies } from "next/headers";

import { readFullSessionUser, type FullClaims } from "./issuer";
import { ADMIN_LOGIN_PATH, requireAdminPage, requireAdminRequest } from "./guard";

const readFullSessionUserMock = vi.mocked(readFullSessionUser);
const cookiesMock = vi.mocked(cookies);

const adminClaims: FullClaims = { sub: "1", role: "admin", jti: "j1", exp: 9999999999 };
const userClaims: FullClaims = { sub: "2", role: "user", jti: "j2", exp: 9999999999 };

function mockCookieHeader(header: string | null): void {
  cookiesMock.mockResolvedValue({
    toString: () => header ?? "",
  } as Awaited<ReturnType<typeof cookies>>);
}

function reqWithCookie(header: string | null): Pick<Request, "headers"> {
  return { headers: new Headers(header ? { cookie: header } : undefined) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("requireAdminPage(admin 页面守卫)", () => {
  it("admin 会话 → 返回 claims,不跳转", async () => {
    mockCookieHeader("ah_at=t");
    readFullSessionUserMock.mockResolvedValue(adminClaims);
    await expect(requireAdminPage()).resolves.toEqual(adminClaims);
    expect(cookiesMock).toHaveBeenCalledOnce();
  });

  it("非 admin 角色 → redirect 登录页(带 next 回跳)", async () => {
    mockCookieHeader("ah_at=t");
    readFullSessionUserMock.mockResolvedValue(userClaims);
    await expect(requireAdminPage()).rejects.toThrow(
      `NEXT_REDIRECT:${ADMIN_LOGIN_PATH}?next=/admin`,
    );
  });

  it("无会话 → redirect 登录页", async () => {
    mockCookieHeader(null);
    readFullSessionUserMock.mockResolvedValue(null);
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:");
  });
});

describe("requireAdminRequest(admin 端点守卫)", () => {
  it("admin 会话 → 返回 claims", async () => {
    readFullSessionUserMock.mockResolvedValue(adminClaims);
    await expect(requireAdminRequest(reqWithCookie("ah_at=t"))).resolves.toEqual(adminClaims);
  });

  it.each([
    ["user 角色", userClaims],
    ["无会话", null],
  ])("%s → null(不抛错,由 Handler 自定 401)", async (_name, claims) => {
    readFullSessionUserMock.mockResolvedValue(claims);
    await expect(requireAdminRequest(reqWithCookie("ah_at=t"))).resolves.toBeNull();
  });

  it("Cookie 头原样透传给会话校验", async () => {
    readFullSessionUserMock.mockResolvedValue(null);
    await requireAdminRequest(reqWithCookie("ah_at=x; other=1"));
    expect(readFullSessionUserMock).toHaveBeenCalledWith("ah_at=x; other=1");
  });
});
