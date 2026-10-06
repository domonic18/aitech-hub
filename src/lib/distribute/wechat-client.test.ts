/**
 * 微信客户端单测(网络/redis 必 mock):/cgi-bin/token 成功/失败形态、
 * errcode 归因与人话、HTTP/网络层错误、契约漂移兜底;
 * 批③:token Redis 缓存(命中零请求/miss 刷新写缓存/NX 锁竞争等待)、
 * 42001 自愈强刷重试一次、uploadimg/add_material/draft add|update 载荷形状。
 */
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

import { redis } from "../redis";
import {
  WechatApiError,
  classifyWechatErrcode,
  fetchWechatToken,
  humanizeWechatError,
  wechatAddCoverMaterial,
  wechatDraftAdd,
  wechatDraftUpdate,
  wechatUploadImage,
  type WechatDraftArticle,
} from "./wechat-client";

const mockedRedis = vi.mocked(redis);

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

/** 按 URL 分流的 fetch stub:每路由一个响应队列——多元素按调用次序依次消费,
 * 单元素/耗尽后固定复用末元素(重试场景给第二个响应即可) */
function stubFetchBy(routes: Record<string, unknown[]>): FetchMock {
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  const fn = vi.fn(async (url: string): Promise<Response> => {
    for (const [needle, bodies] of queues) {
      if (url.includes(needle)) {
        const body = bodies.length > 1 ? (bodies.shift() as unknown) : bodies[0];
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn as unknown as FetchMock;
}

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

const CREDS = { appid: "wxid", appSecret: "secret" };

const ARTICLE: WechatDraftArticle = {
  title: "标题",
  author: "一起AI",
  digest: "摘要",
  content: '<p style="margin:12px 0;">正文</p>',
  content_source_url: "https://17aitech.com/post/1-x",
  thumb_media_id: "COVER",
};

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe("token 缓存(withToken 系共用)", () => {
  it("缓存命中 → 零 token 请求,业务请求直接带上缓存 token", async () => {
    mockedRedis.get.mockResolvedValue("cached-tok");
    const fetchMock = stubFetchBy({ "media/uploadimg": [{ url: "https://mmbiz/x.png" }] });
    const url = await wechatUploadImage(CREDS, new Uint8Array([1]), "a.jpg", "image/jpeg");
    expect(url).toBe("https://mmbiz/x.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("access_token=cached-tok");
    expect(mockedRedis.set).not.toHaveBeenCalled();
  });

  it("缓存 miss → 抢 NX 锁刷新并写缓存(EX=expires_in-200),释放锁", async () => {
    mockedRedis.get.mockResolvedValue(null);
    mockedRedis.set.mockResolvedValue("OK");
    const fetchMock = stubFetchBy({
      "/cgi-bin/token": [{ access_token: "T1", expires_in: 7200 }],
      "media/uploadimg": [{ url: "https://mmbiz/y.png" }],
    });
    await wechatUploadImage(CREDS, new Uint8Array([1]), "a.jpg", "image/jpeg");
    expect(mockedRedis.set).toHaveBeenCalledWith("distribute:wechat:token", "T1", "EX", 7000);
    expect(mockedRedis.del).toHaveBeenCalledWith("distribute:wechat:token:lock");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/cgi-bin/token"))).toBe(true);
  });

  it("锁被他人持有 → 轮询等缓存写入(本端零 token 请求)", async () => {
    mockedRedis.get
      .mockResolvedValueOnce(null) // 初始 miss
      .mockResolvedValueOnce("T2"); // 第一次轮询即拿到
    mockedRedis.set.mockResolvedValue(null as never); // NX 未抢到
    const fetchMock = stubFetchBy({ "media/uploadimg": [{ url: "https://mmbiz/z.png" }] });
    const url = await wechatUploadImage(CREDS, new Uint8Array([1]), "a.jpg", "image/jpeg");
    expect(url).toBe("https://mmbiz/z.png");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/cgi-bin/token"))).toBe(false);
  });

  it("业务 42001 → DEL 缓存强刷重试一次成功", async () => {
    mockedRedis.get.mockResolvedValue("old-tok");
    mockedRedis.set.mockResolvedValue("OK");
    const fetchMock = stubFetchBy({
      "media/uploadimg": [
        { errcode: 42001, errmsg: "access_token expired" }, // 第一次业务
        { url: "https://mmbiz/retry.png" }, // 强刷后重试
      ],
      "/cgi-bin/token": [{ access_token: "T2", expires_in: 7200 }],
    });
    const url = await wechatUploadImage(CREDS, new Uint8Array([1]), "a.jpg", "image/jpeg");
    expect(url).toBe("https://mmbiz/retry.png");
    expect(mockedRedis.del).toHaveBeenCalledWith("distribute:wechat:token");
    const business = fetchMock.mock.calls.filter(([u]) => String(u).includes("uploadimg"));
    expect(business).toHaveLength(2);
    expect(String(business[0][0])).toContain("access_token=old-tok");
    expect(String(business[1][0])).toContain("access_token=T2");
  });

  it("业务非 token 错(如 40006)不重试直接抛", async () => {
    mockedRedis.get.mockResolvedValue("tok");
    stubFetchBy({ "media/uploadimg": [{ errcode: 40006, errmsg: "invalid file size" }] });
    const err = await wechatUploadImage(CREDS, new Uint8Array([1]), "a.jpg", "image/jpeg").catch(
      (e) => e,
    );
    expect((err as WechatApiError).kind).toBe("media");
  });
});

describe("业务接口载荷", () => {
  beforeEach(() => {
    mockedRedis.get.mockResolvedValue("tok");
  });

  it("uploadimg:POST multipart 字段 media(带文件名与 MIME)", async () => {
    const fetchMock = stubFetchBy({ "media/uploadimg": [{ url: "https://mmbiz/1.png" }] });
    await wechatUploadImage(CREDS, new Uint8Array([1, 2]), "pic.png", "image/png");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/cgi-bin/media/uploadimg?access_token=tok");
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    const media = form.get("media") as File;
    expect(media.name).toBe("pic.png");
    expect(media.type).toBe("image/png");
  });

  it("add_material?type=image:回 media_id/url;缺 media_id 报契约漂移", async () => {
    const fetchMock = stubFetchBy({
      "material/add_material": [{ media_id: "MEDIA1", url: "https://mmbiz/m.png" }],
    });
    const r = await wechatAddCoverMaterial(CREDS, new Uint8Array([1]), "cover.jpg", "image/jpeg");
    expect(r).toEqual({ mediaId: "MEDIA1", url: "https://mmbiz/m.png" });
    expect(fetchMock.mock.calls[0][0]).toContain("material/add_material?type=image");

    stubFetchBy({ "material/add_material": [{ errcode: 0 }] });
    const err = await wechatAddCoverMaterial(
      CREDS,
      new Uint8Array([1]),
      "c.jpg",
      "image/jpeg",
    ).catch((e) => e);
    expect((err as WechatApiError).message).toContain("契约漂移");
  });

  it("draft/add:articles 数组载荷,回草稿 media_id", async () => {
    const fetchMock = stubFetchBy({ "draft/add": [{ media_id: "DRAFT1" }] });
    const mediaId = await wechatDraftAdd(CREDS, ARTICLE);
    expect(mediaId).toBe("DRAFT1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/cgi-bin/draft/add?access_token=tok");
    const sent = JSON.parse(init?.body as string);
    expect(sent.articles).toHaveLength(1);
    expect(sent.articles[0].thumb_media_id).toBe("COVER");
    expect(sent.articles[0].content_source_url).toContain("/post/1-x");
  });

  it("draft/update:media_id + index:0 + articles 单对象;errcode 0 即成功", async () => {
    const fetchMock = stubFetchBy({ "draft/update": [{ errcode: 0 }] });
    await wechatDraftUpdate(CREDS, "DRAFT1", ARTICLE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/cgi-bin/draft/update?access_token=tok");
    const sent = JSON.parse(init?.body as string);
    expect(sent.media_id).toBe("DRAFT1");
    expect(sent.index).toBe(0);
    expect(sent.articles.title).toBe("标题");
    expect(Array.isArray(sent.articles)).toBe(false);
  });
});
