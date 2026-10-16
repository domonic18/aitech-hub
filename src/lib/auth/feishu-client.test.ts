/**
 * 飞书 OpenAPI 客户端单测(redis mock + fetcher 注入,零真网):app_token
 * 缓存命中与回写、OAuth v2 兑换链(token→user_info)请求契约
 * (client_id/secret 直换)与 union_id 缺失拒、上游 code!==0 / 非 JSON /
 * 网络失败归一 upstream。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { redis } from "../redis";
import { exchangeFeishuIdentity, getAppAccessToken, type Fetcher } from "./feishu-client";

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

describe("exchangeFeishuIdentity", () => {
  it("v2 两跳成功 → unionId/openId/name;token 请求契约 client_id/secret 直换(零 app_token 前置)", async () => {
    const f = fetcherBy({
      "authen/v2/oauth/token": { access_token: "UT" },
      "authen/v1/user_info": {
        code: 0,
        data: { union_id: "ou-union", open_id: "ou-open", name: "张三" },
      },
    });
    expect(await exchangeFeishuIdentity(CREDS, "authcode", f)).toEqual({
      unionId: "ou-union",
      openId: "ou-open",
      name: "张三",
    });
    // v2 契约冻结:grant/client_id/client_secret 直换,不携带 app_token/redirect_uri
    const calls = (f as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    const tokenCall = calls.find(([url]) => url.includes("oauth/token"));
    expect(JSON.parse(String(tokenCall?.[1]?.body))).toEqual({
      grant_type: "authorization_code",
      client_id: "cli_x",
      client_secret: "secret",
      code: "authcode",
    });
  });

  it("授权码无效(扁平 OAuth 错误体)→ upstream 且透出 error_description;union_id 缺失 → invalid", async () => {
    const f = fetcherBy({
      "authen/v2/oauth/token": { error: "InvalidCode", error_description: "code has been used" },
    });
    await expect(exchangeFeishuIdentity(CREDS, "bad", f)).rejects.toMatchObject({
      code: "upstream",
      message: expect.stringContaining("code has been used"),
    });

    const f2 = fetcherBy({
      "authen/v2/oauth/token": { access_token: "UT" },
      "authen/v1/user_info": { code: 0, data: { open_id: "ou-open" } },
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
