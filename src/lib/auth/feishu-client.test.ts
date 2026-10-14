/**
 * 飞书 OpenAPI 客户端单测(redis mock + fetcher 注入,零真网):app_token /
 * jsapi_ticket 缓存命中与回写、H5 签名四段顺序 sha1 复算、OIDC 兑换链
 * (token→user_info)union_id 缺失拒、上游 code!==0 / 非 JSON / 网络失败
 * 归一 upstream。
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { redis } from "../redis";
import {
  exchangeFeishuIdentity,
  getAppAccessToken,
  getJsapiTicket,
  signJsapi,
  type Fetcher,
} from "./feishu-client";

const mockedRedis = vi.mocked(redis);

const CREDS = { appId: "cli_x", appSecret: "secret" };

/** 注入式 fetch stub:按 URL 包含匹配分流;值为数组时按调用次序依次消费 */
function fetcherBy(routes: Record<string, unknown>): Fetcher {
  const queues = new Map(
    Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  return vi.fn(async (url: string): Promise<Response> => {
    for (const [needle, bodies] of queues) {
      if (url.includes(needle)) {
        const body = bodies.length > 1 ? (bodies.shift() as unknown) : bodies[0];
        if (body instanceof Response) return body;
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  }) as unknown as Fetcher;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRedis.get.mockResolvedValue(null);
  mockedRedis.set.mockResolvedValue("OK");
});

describe("getAppAccessToken", () => {
  it("缓存命中零外呼;miss 请求成功按 expire-300s 回写", async () => {
    mockedRedis.get.mockResolvedValueOnce("CACHED");
    const f = fetcherBy({});
    expect(await getAppAccessToken(CREDS, f)).toBe("CACHED");
    expect(f).not.toHaveBeenCalled();

    const f2 = fetcherBy({ "app_access_token/internal": { app_access_token: "AT", expire: 7200 } });
    expect(await getAppAccessToken(CREDS, f2)).toBe("AT");
    expect(mockedRedis.set).toHaveBeenCalledWith("feishu:app_token", "AT", "EX", 6900);
  });

  it("code!==0 → FeishuError(upstream);缓存故障降级直连", async () => {
    const f = fetcherBy({ "app_access_token/internal": { code: 10003, msg: "invalid app_id" } });
    await expect(getAppAccessToken(CREDS, f)).rejects.toMatchObject({ code: "upstream" });

    mockedRedis.get.mockRejectedValueOnce(new Error("redis down"));
    const f2 = fetcherBy({ "app_access_token/internal": { app_access_token: "AT2", expire: 600 } });
    expect(await getAppAccessToken(CREDS, f2)).toBe("AT2");
  });
});

describe("getJsapiTicket", () => {
  it("ticket 回写(嵌套 data 形态);缺 ticket → upstream", async () => {
    const f = fetcherBy({
      "jssdk/ticket/get": { code: 0, data: { ticket: "TICKET", expire_sec: 7200 } },
      "app_access_token/internal": { app_access_token: "AT", expire: 7200 },
    });
    expect(await getJsapiTicket(CREDS, f)).toBe("TICKET");
    expect(mockedRedis.set).toHaveBeenCalledWith("feishu:jsapi_ticket", "TICKET", "EX", 6900);

    const f2 = fetcherBy({
      "jssdk/ticket/get": { code: 0, data: {} },
      "app_access_token/internal": { app_access_token: "AT" },
    });
    await expect(getJsapiTicket(CREDS, f2)).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("signJsapi", () => {
  it("四段顺序冻结:sha1(jsapi_ticket=..&noncestr=..&timestamp=..&url=..)", () => {
    const sign = signJsapi(CREDS, "T", "https://17aitech.com/admin?x=1");
    const expected = createHash("sha1")
      .update(
        `jsapi_ticket=T&noncestr=${sign.nonceStr}&timestamp=${sign.timestamp}&url=https://17aitech.com/admin?x=1`,
      )
      .digest("hex");
    expect(sign.signature).toBe(expected);
    expect(sign.appId).toBe("cli_x");
    expect(sign.timestamp).toMatch(/^\d{10}$/);
  });
});

describe("exchangeFeishuIdentity", () => {
  it("OIDC 两跳成功 → unionId/openId/name", async () => {
    const f = fetcherBy({
      "oidc/access_token": { code: 0, data: { access_token: "UT" } },
      "authen/v1/user_info": {
        code: 0,
        data: { union_id: "ou-union", open_id: "ou-open", name: "张三" },
      },
      "app_access_token/internal": { app_access_token: "AT" },
    });
    expect(await exchangeFeishuIdentity(CREDS, "authcode", f)).toEqual({
      unionId: "ou-union",
      openId: "ou-open",
      name: "张三",
    });
  });

  it("授权码无效(无 user token)→ upstream;union_id 缺失 → invalid", async () => {
    const f = fetcherBy({
      "oidc/access_token": { code: 0, data: {} },
      "app_access_token/internal": { app_access_token: "AT" },
    });
    await expect(exchangeFeishuIdentity(CREDS, "bad", f)).rejects.toMatchObject({
      code: "upstream",
    });

    const f2 = fetcherBy({
      "oidc/access_token": { code: 0, data: { access_token: "UT" } },
      "authen/v1/user_info": { code: 0, data: { open_id: "ou-open" } },
      "app_access_token/internal": { app_access_token: "AT" },
    });
    await expect(exchangeFeishuIdentity(CREDS, "code", f2)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("非 JSON / 网络异常 → upstream", async () => {
    const badJson: Fetcher = vi.fn(async () => new Response("oops", { status: 200 }));
    await expect(exchangeFeishuIdentity(CREDS, "c", badJson)).rejects.toMatchObject({
      code: "upstream",
    });
    const netFail: Fetcher = vi.fn(async () => {
      throw new Error("econnrefused");
    });
    await expect(exchangeFeishuIdentity(CREDS, "c", netFail)).rejects.toMatchObject({
      code: "upstream",
    });
  });
});
