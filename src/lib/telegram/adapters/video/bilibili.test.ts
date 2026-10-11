/**
 * B站适配器单测:vi.stubGlobal fetch 打桩网关(douyin.test.ts 同手法),
 * 验「HTTP 往返 + 归一化 + 异常翻译 + platform 请求形状」——wbi 签名/风控
 * 归因在 Python 网关侧有独立对拍测试(test_bilibili_api.py)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../env", () => ({ env: { DOUYIN_GATEWAY_URL: "http://gateway.test:8010" } }));

import { bilibiliAdapter, fetchBilibiliProfile, resolveBilibiliMid } from "./bilibili";
import { downloadHeadersFor, GatewayUnavailableError, GatewayUpstreamError } from "./index";

const JARS = ["buvid3=abc; buvid4=xyz; b_nut=123"];
const MID = "9469941";

function gatewayBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    videos: [
      {
        video_id: "BV1xx411c7mD",
        caption: "10分钟看懂大模型\n本期聊推理优化",
        topic_tags: [],
        cover_url: "https://i0.hdslb.com/bfs/archive/cover.jpg",
        play_url: null, // vlist 不带直链(契约钉死)
        duration_seconds: 603,
        published_at: "2025-09-14T19:50:00+08:00",
        digg_count: null,
        comment_count: 214,
        share_count: null,
        play_count: 52341,
      },
      { caption: "缺 video_id 丢弃" },
    ],
    has_more: true,
    max_cursor: 2,
    ...over,
  });
}

describe("bilibiliAdapter.fetchRecentVideos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("网关 200:归一化条目(play=play_count/like 恒 null/playUrl 恒 null),无 video_id 丢弃", async () => {
    const fetchMock = vi.fn(async () => new Response(gatewayBody(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const items = await bilibiliAdapter.fetchRecentVideos({ secUid: MID, cookies: JARS });
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.videoId).toBe("BV1xx411c7mD");
    expect(item.title).toBe("10分钟看懂大模型");
    expect(item.caption).toBe("10分钟看懂大模型\n本期聊推理优化");
    expect(item.url).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(item.publishedAt).toEqual(new Date("2025-09-14T19:50:00+08:00"));
    expect(item.coverUrl).toBe("https://i0.hdslb.com/bfs/archive/cover.jpg");
    expect(item.durationSeconds).toBe(603);
    expect(item.engagement).toEqual({ play: 52341, like: null, comment: 214 });
    expect(item.topicTags).toEqual([]);
    // listing 不带直链:解读侧 /play-url 现查(版权红线:过境即焚,禁落库)
    expect(item.playUrl).toBeNull();
  });

  it("请求形状:payload 带 platform=bilibili,sec_uid=mid,max_pages 默认 1/回填钳 3", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload).toEqual({
        platform: "bilibili",
        sec_uid: MID,
        cookies: JARS,
        max_pages: 1,
      });
      return new Response(gatewayBody(), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await bilibiliAdapter.fetchRecentVideos({ secUid: MID, cookies: JARS });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        void url;
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(payload.max_pages).toBe(3);
        return new Response(gatewayBody(), { status: 200 });
      }),
    );
    await bilibiliAdapter.fetchRecentVideos({ secUid: MID, cookies: JARS, maxPages: 9 });
  });

  it("404 账号失效 {error,detail} → GatewayUpstreamError(计博主失败)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "AccountInvalidError", detail: " 用户不存在" }), {
            status: 404,
          }),
      ),
    );
    const err = await bilibiliAdapter
      .fetchRecentVideos({ secUid: MID, cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("AccountInvalidError");
  });

  it("502 风控(RiskControlError)→ GatewayUpstreamError,detail 透传", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "RiskControlError", detail: " code=-352" }), {
            status: 502,
          }),
      ),
    );
    const err = await bilibiliAdapter
      .fetchRecentVideos({ secUid: MID, cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("RiskControlError");
    expect((err as GatewayUpstreamError).message).toContain("code=-352");
  });

  it("503 槽位未就绪 → GatewayUnavailableError(顺延不计失败);连接失败同", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ detail: "签名服务未就绪" }), { status: 503 }),
      ),
    );
    await expect(
      bilibiliAdapter.fetchRecentVideos({ secUid: MID, cookies: JARS }),
    ).rejects.toBeInstanceOf(GatewayUnavailableError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(
      bilibiliAdapter.fetchRecentVideos({ secUid: MID, cookies: JARS }),
    ).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it("200 但响应不合契约 → GatewayUpstreamError kind=ContractDrift", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ videos: "not-an-array" }), { status: 200 })),
    );
    const err = await bilibiliAdapter
      .fetchRecentVideos({ secUid: MID, cookies: JARS })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayUpstreamError);
    expect((err as GatewayUpstreamError).kind).toBe("ContractDrift");
  });
});

describe("profile / resolve", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("/profile 返回昵称头像(payload 带 platform);/resolve 返回 mid", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { url?: string; platform?: string };
      if (body.url !== undefined) {
        expect(body.platform).toBe("bilibili");
        return new Response(JSON.stringify({ sec_uid: MID }), { status: 200 });
      }
      expect(body).toMatchObject({ platform: "bilibili", sec_uid: MID });
      return new Response(
        JSON.stringify({
          sec_uid: MID,
          nickname: "AI 技术漫谈",
          avatar_url: "https://i0.hdslb.com/bfs/face/a.jpg",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchBilibiliProfile(MID, JARS)).toEqual({
      secUid: MID,
      nickname: "AI 技术漫谈",
      avatarUrl: "https://i0.hdslb.com/bfs/face/a.jpg",
    });
    expect(await resolveBilibiliMid("https://space.bilibili.com/9469941")).toBe(MID);
  });
});

describe("downloadHeadersFor", () => {
  it("bilibili 带 Referer 防盗链头;其他平台空", () => {
    expect(downloadHeadersFor("bilibili")).toEqual({ Referer: "https://www.bilibili.com/" });
    expect(downloadHeadersFor("douyin")).toEqual({});
  });
});
