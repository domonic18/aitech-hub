/**
 * visitor 单测:cookie 读取(合法 uuid/缺/非法)、fresh 判定、cookie 属性
 * (httpOnly/sameSite lax/secure 按 SITE_URL/365d/path /)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({ env: { NEXT_PUBLIC_SITE_URL: "https://17aitech.com" } }));

import {
  attachVisitorCookie,
  newVisitorId,
  readVisitorId,
  resolveVisitorId,
  VISITOR_COOKIE_MAX_AGE,
  VISITOR_COOKIE_NAME,
} from "./visitor";

function reqWithCookie(value?: string): {
  cookies: { get: (n: string) => { value: string } | undefined };
} {
  return {
    cookies: {
      get: (n: string) =>
        n === VISITOR_COOKIE_NAME && value !== undefined ? { value } : undefined,
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("readVisitorId", () => {
  it("合法 uuid 通过(大小写均可)", () => {
    const id = "0b9e6c1a-7f2e-4c3d-9a1b-2f3e4d5c6b7a";
    expect(readVisitorId(reqWithCookie(id) as never)).toBe(id);
    expect(readVisitorId(reqWithCookie(id.toUpperCase()) as never)).toBe(id.toUpperCase());
  });
  it("缺/非法/畸形 → null", () => {
    expect(readVisitorId(reqWithCookie() as never)).toBeNull();
    expect(readVisitorId(reqWithCookie("not-a-uuid") as never)).toBeNull();
    expect(readVisitorId(reqWithCookie("'; drop table--") as never)).toBeNull();
  });
});

describe("resolveVisitorId", () => {
  it("已有合法 cookie → 复用且 fresh=false", () => {
    const id = newVisitorId();
    const r = resolveVisitorId(reqWithCookie(id) as never);
    expect(r).toEqual({ id, fresh: false });
  });
  it("无 cookie → 新造 uuid 且 fresh=true", () => {
    const r = resolveVisitorId(reqWithCookie() as never);
    expect(r.fresh).toBe(true);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("attachVisitorCookie", () => {
  it("属性:httpOnly/sameSite lax/secure(https)/365d/path /", () => {
    const set = vi.fn();
    const res = { cookies: { set } } as never;
    attachVisitorCookie(res, "v-id");
    expect(set).toHaveBeenCalledWith(
      VISITOR_COOKIE_NAME,
      "v-id",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        maxAge: VISITOR_COOKIE_MAX_AGE,
        path: "/",
      }),
    );
  });
});
