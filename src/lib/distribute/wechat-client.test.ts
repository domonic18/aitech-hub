/**
 * 微信客户端单测(网络必 mock):/cgi-bin/token 成功/失败形态、
 * errcode 归因与人话、HTTP/网络层错误、契约漂移兜底。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WechatApiError,
  classifyWechatErrcode,
  fetchWechatToken,
  humanizeWechatError,
} from "./wechat-client";

function stubFetch(body: unknown, init?: { ok?: boolean; status?: number }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status: init?.status ?? 200,
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWechatToken", () => {
  it("成功形态(无 errcode 字段)→ accessToken/expiresIn", async () => {
    stubFetch({ access_token: "AT", expires_in: 7200 });
    const r = await fetchWechatToken("wxid", "secret");
    expect(r.accessToken).toBe("AT");
    expect(r.expiresIn).toBe(7200);
  });

  it("errcode 40001 → WechatApiError kind=token,人话含码", async () => {
    stubFetch({ errcode: 40001, errmsg: "invalid credential" });
    const err = await fetchWechatToken("wxid", "secret").catch((e) => e);
    expect(err).toBeInstanceOf(WechatApiError);
    expect((err as WechatApiError).kind).toBe("token");
    expect((err as WechatApiError).message).toContain("40001");
  });

  it("errcode 40164 → kind=ip_whitelist,人话含白名单指引", async () => {
    stubFetch({ errcode: 40164, errmsg: "invalid ip 1.2.3.4 ipv6 ::ffff" });
    const err = (await fetchWechatToken("wxid", "secret").catch((e) => e)) as WechatApiError;
    expect(err.kind).toBe("ip_whitelist");
    expect(err.message).toContain("IP 白名单");
  });

  it("HTTP 500 / 非 JSON → network", async () => {
    stubFetch("oops", { status: 500 });
    expect(((await fetchWechatToken("a", "b").catch((e) => e)) as WechatApiError).kind).toBe(
      "network",
    );
    stubFetch("not-json");
    expect(((await fetchWechatToken("a", "b").catch((e) => e)) as WechatApiError).kind).toBe(
      "network",
    );
  });

  it("缺 access_token(契约漂移)→ unknown", async () => {
    stubFetch({ expires_in: 7200 });
    expect(((await fetchWechatToken("a", "b").catch((e) => e)) as WechatApiError).kind).toBe(
      "unknown",
    );
  });
});

describe("classifyWechatErrcode / humanizeWechatError", () => {
  it("已知码归因:token/ip_whitelist/config/media/limit", () => {
    expect(classifyWechatErrcode(42001)).toBe("token");
    expect(classifyWechatErrcode(40164)).toBe("ip_whitelist");
    expect(classifyWechatErrcode(40125)).toBe("config");
    expect(classifyWechatErrcode(40006)).toBe("media");
    expect(classifyWechatErrcode(45009)).toBe("limit");
  });

  it("未知码归 unknown,人话透出原始 errmsg", () => {
    expect(classifyWechatErrcode(99999)).toBe("unknown");
    expect(humanizeWechatError(99999, "某错误")).toContain("某错误");
  });

  it("config 类人话点明 AppID/AppSecret", () => {
    expect(humanizeWechatError(40125, "invalid appsecret")).toContain("AppSecret");
  });
});
