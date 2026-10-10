import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { AUTH_SECRET: "test-secret-0123456789-abcdef" },
}));

import { ACCESS_COOKIE_NAME, verifyAccessToken } from "./session";

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

describe("单一契约钉死(2026-10-09 收银台死循环事故)", () => {
  it("只吃裸 token 值;完整 Cookie 头形态一律拒验(防双契约复活)", async () => {
    const token = await sign({ sub: "7", role: "user" }, "2h");
    expect(await verifyAccessToken(token)).toEqual({ sub: "7", role: "user" });

    // 曾有 readSessionUser(完整头) 并存:把裸值误当头解析 → 恒 null,
    // 已登录被当未登录,/pay 死循环弹登录。此形态必须保持不可解析。
    expect(await verifyAccessToken(`${ACCESS_COOKIE_NAME}=${token}`)).toBeNull();
    expect(await verifyAccessToken(`other=1; ${ACCESS_COOKIE_NAME}=${token}`)).toBeNull();
  });
});
