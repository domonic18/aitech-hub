/**
 * 抖音适配器单测:vi.stubGlobal fetch 打桩网关(rss.test.ts 同手法),
 * 只验「HTTP 往返 + 异常翻译」——签名/风控在 Python 网关侧有独立对拍测试。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../env", () => ({ env: { DOUYIN_GATEWAY_URL: "http://gateway.test:8010" } }));

import { douyinAdapter, fetchDouyinProfile, resolveDouyinSecUid } from "./douyin";
import { GatewayUnavailableError, GatewayUpstreamError } from "./index";

const JARS = ["ttwid=abc; sessionid=x; msToken=y"];

function gatewayBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    videos: [
      {
        video_id: "7301234567890",
        caption: "标题第一行\n第二行话题 #AI",
        topic_tags: ["AI"],
        cover_url: "https://p.douyinpic.com/cover.jpeg",
        play_url: "https://v.douyinvod.com/x", // 网关透出,适配器不得映射
        duration_seconds: 95,
        published_at: "2026-10-03T08:00:00+08:00",
        digg_count: 120,
        comment_count: 34,
        share_count: 5,
      },
      { caption: "缺 video_id 丢弃" },
    ],
    has_more: false,
    max_cursor: 0,
    ...over,
  });
}

describe("douyinAdapter.fetchRecentVideos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("网关 200:归一化条目(标题取首行/like=digg),无 video_id 丢弃", async () => {
    const fetchMock = vi.fn(async () => new Response(gatewayBody(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const items = await douyinAdapter.fetchRecentVideos({ secUid: "sec-abc", cookies: JARS });
    expect(items).toHaveLength(1);
    const it = items[0]!;
    expect(it.videoId).toBe("7301234567890");
    expect(it.title).toBe("标题第一行");
    expect(it.caption).toBe("标题第一行\n第二行话题 #AI");
    expect(it.url).toBe("https://www.douyin.com/video/7301234567890");
    expect(it.publishedAt).toEqual(new Date("2026-10-03T08:00:00+08:00"));
    expect(it.coverUrl).toBe("https://p.douyinpic.com/cover.jpeg");
    expect(it.durationSeconds).toBe(95);
    expect(it.engagement).toEqual({ play: null, like: 120, comment: 34 });
    expect(it.topicTags).toEqual(["AI"]);
    expect(Object.keys(it)).not.toContain("playUrl"); // 版权红线:play_url 不出适配器

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gateway.test:8010/posts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sec_uid: "sec-abc", cookies: JARS, max_pages: 1 }),
      }),
    );
  });

  it("网关业务错误 {error,detail} → GatewayUpstreamError(计博主失败)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "AccountInvalidError", detail: " jar 全灭" }), {
            status: 404,
          }),
      ),
    );
    const err = await douyinAdapter
      .fetchRecentVideos({ secUid: "s", cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("AccountInvalidError");
  });

  it("503 浏览器槽位未就绪(仅 detail)→ GatewayUnavailableError(顺延不计失败)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ detail: "签名服务未就绪" }), { status: 503 }),
      ),
    );
    await expect(
      douyinAdapter.fetchRecentVideos({ secUid: "s", cookies: JARS }),
    ).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it("502 适配层失败(仅 detail,无 error)→ GatewayUpstreamError(计入失败,不再误归顺延)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "SignPageError: 风控" }), { status: 502 }),
      ),
    );
    const err = await douyinAdapter
      .fetchRecentVideos({ secUid: "s", cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("HTTP 502");
    expect((err as GatewayUpstreamError).message).toContain("SignPageError: 风控");
  });

  it("422 pydantic 校验(detail 数组)→ GatewayUpstreamError kind=HTTP 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: [{ loc: ["body", "sec_uid"] }] }), {
            status: 422,
          }),
      ),
    );
    const err = await douyinAdapter
      .fetchRecentVideos({ secUid: "s", cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("HTTP 422");
  });

  it("200 但响应不合契约 → GatewayUpstreamError kind=ContractDrift", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ videos: "not-an-array" }), { status: 200 })),
    );
    const err = await douyinAdapter
      .fetchRecentVideos({ secUid: "s", cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("ContractDrift");
  });

  it("非 JSON 错误体(502 html)→ GatewayUpstreamError;连接失败 → GatewayUnavailableError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    const err = await douyinAdapter
      .fetchRecentVideos({ secUid: "s", cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("HTTP 502");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(
      douyinAdapter.fetchRecentVideos({ secUid: "s", cookies: JARS }),
    ).rejects.toBeInstanceOf(GatewayUnavailableError);
  });
});

describe("profile / resolve", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("/profile 返回昵称头像;/resolve 返回 sec_uid", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { url?: string };
      const payload = body.url
        ? { sec_uid: "MS4wLjABAAAAresolved" }
        : { sec_uid: "MS4wLjABAAAAresolved", nickname: "AI 前沿", avatar_url: null };
      void url;
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchDouyinProfile("sec-abc", JARS)).toEqual({
      secUid: "MS4wLjABAAAAresolved",
      nickname: "AI 前沿",
      avatarUrl: null,
    });
    expect(await resolveDouyinSecUid("https://v.douyin.com/xxx/")).toBe("MS4wLjABAAAAresolved");
  });
});
