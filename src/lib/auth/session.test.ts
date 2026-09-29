import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { AUTH_SECRET: "test-secret-0123456789-abcdef" },
}));

import { ACCESS_COOKIE_NAME, readSessionUser, verifyAccessToken } from "./session";

const secret = new TextEncoder().encode("test-secret-0123456789-abcdef");

async function sign(claims: Record<string, unknown>, expires: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expires)
    .sign(secret);
}

describe("verifyAccessToken(读侧最小实现,M4 扩展签发)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("合法 token 返回 claims", async () => {
    const token = await sign({ sub: "42", role: "user" }, "2h");
    expect(await verifyAccessToken(token)).toEqual({ sub: "42", role: "user" });
  });

  it("过期 token → null", async () => {
    const token = await sign({ sub: "42", role: "user" }, "-1h");
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("篡改/空值 → null", async () => {
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
    expect(await verifyAccessToken(undefined)).toBeNull();
    expect(await verifyAccessToken("")).toBeNull();
  });

  it("载荷缺字段 → null", async () => {
    const token = await sign({ sub: "42" }, "2h");
    expect(await verifyAccessToken(token)).toBeNull();
  });
});

describe("readSessionUser(从 Cookie 头解析)", () => {
  it("取出 ah_at 并校验", async () => {
    const token = await sign({ sub: "7", role: "admin" }, "2h");
    const header = `other=1; ${ACCESS_COOKIE_NAME}=${token}; x=2`;
    expect(await readSessionUser(header)).toEqual({ sub: "7", role: "admin" });
  });

  it("无会话 Cookie → null", async () => {
    expect(await readSessionUser(null)).toBeNull();
    expect(await readSessionUser("other=1")).toBeNull();
  });
});
