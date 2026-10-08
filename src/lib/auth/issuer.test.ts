/**
 * issuer 单测:Redis 用内存 Map 替身(get/set/del/expire 够用,TTL 语义不模拟——
 * 过期行为由 redis 兜底,这里只钉登记/吊销/轮换逻辑)。
 */
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    AUTH_SECRET: "test-secret-0123456789-abcdef",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

const store = new Map<string, string>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  },
}));

import {
  issueSession,
  needsRenewal,
  readFullSessionUser,
  renewSession,
  revokeSession,
  sessionCookie,
  SLIDE_THRESHOLD_SECONDS,
  verifyFullSession,
} from "./issuer";
import { ACCESS_COOKIE_NAME } from "./session";

describe("issueSession / verifyFullSession(签发与完整校验)", () => {
  it("签发后完整校验通过,claims 含 jti/exp", async () => {
    const { token } = await issueSession({ sub: "42", role: "admin" });
    const claims = await verifyFullSession(token);
    expect(claims).toMatchObject({ sub: "42", role: "admin", exp: expect.any(Number) });
    expect(claims?.jti).toBeTruthy();
  });

  it("吊销 jti 后校验返回 null(验签仍过,登记不在)", async () => {
    const { token, jti } = await issueSession({ sub: "42", role: "admin" });
    await revokeSession(jti);
    expect(await verifyFullSession(token)).toBeNull();
  });

  it("无 jti 载荷/垃圾 token → null", async () => {
    expect(await verifyFullSession("not-a-jwt")).toBeNull();
    expect(await verifyFullSession(null)).toBeNull();
  });

  it("他钥签发的合法 JWT → null(验签不通过)", async () => {
    const otherToken = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("42")
      .setJti("forged")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(new TextEncoder().encode("another-secret-0123456789-xyz"));
    expect(await verifyFullSession(otherToken)).toBeNull();
  });
});

describe("readFullSessionUser(从 Cookie 头解析)", () => {
  it("混排 Cookie 中定位 ah_at", async () => {
    const { token } = await issueSession({ sub: "7", role: "admin" });
    expect(await readFullSessionUser(`other=1; ${ACCESS_COOKIE_NAME}=${token}`)).toMatchObject({
      sub: "7",
    });
  });

  it("无 Cookie 头 → null", async () => {
    expect(await readFullSessionUser(null)).toBeNull();
  });
});

describe("滑动续期(轮换)", () => {
  it("剩余 >1d 不续;剩余 <1d 需续", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      needsRenewal({ sub: "1", role: "admin", jti: "a", exp: now + SLIDE_THRESHOLD_SECONDS + 60 }),
    ).toBe(false);
    expect(needsRenewal({ sub: "1", role: "admin", jti: "a", exp: now + 60 })).toBe(true);
  });

  it("续期轮换 jti:新 token 可校验,旧 jti 吊销", async () => {
    const first = await issueSession({ sub: "42", role: "admin" });
    const old = await verifyFullSession(first.token);
    expect(old).not.toBeNull();
    const newToken = await renewSession(old!);
    expect(newToken).not.toBe(first.token);
    expect(await verifyFullSession(first.token)).toBeNull(); // 旧失效
    expect(await verifyFullSession(newToken)).toMatchObject({ sub: "42" }); // 新有效
  });
});

describe("sessionCookie(Cookie 形态)", () => {
  it("http + 本地站点 → secure 关;有效值 maxAge=7d", () => {
    const c = sessionCookie("tok");
    expect(c).toMatchObject({
      name: "ah_at",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
  });

  it("空值 = 清除态:maxAge 0", () => {
    expect(sessionCookie("").maxAge).toBe(0);
  });
});
