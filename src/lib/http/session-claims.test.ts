/**
 * requireSessionClaims 单测(守卫共用会话半段):钉 safe-method 豁免——
 * 同源 fetch GET 不带 Origin 头(isSameOrigin=false),读请求仍放行、写请求
 * 仍被 Origin 关拦下;会话校验对读写同等生效。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { AUTH_SECRET: "test-secret-0123456789-abcdef" },
}));
vi.mock("@/lib/http/origin", () => ({ isSameOrigin: vi.fn(() => false) }));
vi.mock("@/lib/auth/guard", () => ({
  requireAdminRequest: vi.fn(async () => ({
    sub: "597",
    jti: "jti-x",
    exp: 9999999999,
    role: "admin",
  })),
}));

import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import type { NextRequest } from "next/server";

import { requireSessionClaims } from "./session-claims";

function req(method: string): NextRequest {
  return new Request("http://localhost:3000/api/x/", { method }) as NextRequest;
}

describe("requireSessionClaims(safe-method 豁免只放宽 Origin 关)", () => {
  beforeEach(() => {
    vi.mocked(isSameOrigin).mockReturnValue(false);
    vi.mocked(requireAdminRequest).mockImplementation(async () => ({
      sub: "597",
      jti: "jti-x",
      exp: 9999999999,
      role: "admin",
    }));
  });

  it("GET + 无 Origin(同源 fetch 形态)→ 放行,返回 claims.sub", async () => {
    const r = await requireSessionClaims(req("GET"));
    expect(r).toEqual({ kind: "ok", sub: "597" });
  });

  it("HEAD 同享豁免", async () => {
    expect(await requireSessionClaims(req("HEAD"))).toEqual({ kind: "ok", sub: "597" });
  });

  it("POST + 无 Origin → 403 cross-origin(CSRF 关不放宽)", async () => {
    const r = await requireSessionClaims(req("POST"));
    expect(r.kind === "reject" ? r.response.status : -1).toBe(403);
  });

  it("POST + 同源 → 放行(Origin 关只对写生效,不放行无效会话)", async () => {
    vi.mocked(isSameOrigin).mockReturnValue(true);
    expect(await requireSessionClaims(req("POST"))).toEqual({ kind: "ok", sub: "597" });
  });

  it("GET 也必过会话校验:claims 为空 → 401(豁免不等于免鉴权)", async () => {
    vi.mocked(requireAdminRequest).mockImplementation(async () => null);
    const r = await requireSessionClaims(req("GET"));
    expect(r.kind === "reject" ? r.response.status : -1).toBe(401);
  });
});
