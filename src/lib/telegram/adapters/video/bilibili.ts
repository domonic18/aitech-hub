/**
 * B站适配器(M24):经 douyin-gateway B站面拉 UP 主 listing/主页/身份解析。
 * 与抖音同构的「HTTP 往返 + Zod 校验 + 异常翻译」薄层(共享 gateway-http);
 * wbi 签名/风控归因/jar 冷却全在网关。与抖音两点关键差异:
 * ① 身份是纯数字 mid(非 sec_uid),请求 payload 带 platform 分发;
 * ② listing(vlist)不带直链——playUrl 恒 null,解读侧经 POST /play-url 现查。
 */
import { VIDEO_PLATFORM_BILIBILI } from "../../constants";

import {
  playUrlResponseSchema,
  postsResponseSchema,
  profileResponseSchema,
  resolveResponseSchema,
  type GatewayVideo,
} from "./gateway-contract";
import { gatewayPost } from "./gateway-http";
import { type VideoAdapter, type VideoItem } from "./index";

const MAX_PAGES = 3;

function toVideoItem(raw: GatewayVideo): VideoItem | null {
  if (!raw.video_id) return null;
  const caption = raw.caption ?? null;
  // 标题取「标题\n简介」拼接文案首行(与抖音口播描述同口径)
  const title = caption?.split("\n")[0].trim() || caption || "";
  // 外链用 canonical 稳定形(/video/{BV 号})
  return {
    videoId: raw.video_id,
    title,
    caption,
    url: `https://www.bilibili.com/video/${raw.video_id}`,
    publishedAt: raw.published_at ? new Date(raw.published_at) : null,
    coverUrl: raw.cover_url ?? null,
    durationSeconds: raw.duration_seconds ?? null,
    // 播放=play_count(vlist 有值);点赞 vlist 不透出恒 null,前台隐藏
    engagement: {
      play: raw.play_count ?? null,
      like: raw.digg_count ?? null,
      comment: raw.comment_count ?? null,
    },
    topicTags: raw.topic_tags,
    // vlist 无直链键(契约钉 play_url:null):解读侧 /play-url 现查,禁从 listing 假设
    playUrl: null,
  };
}

export const bilibiliAdapter: VideoAdapter = {
  platform: VIDEO_PLATFORM_BILIBILI,

  async fetchRecentVideos({ secUid, cookies, maxPages, proxy }) {
    // sec_uid 语义 per-platform(arch/03):bilibili = 纯数字 mid(契约 superRefine 同矩阵);
    // 翻页上限由编排层传入(常规增量 1,手动回填 3),网关侧兜底钳制
    const data = await gatewayPost(
      "/posts",
      {
        platform: VIDEO_PLATFORM_BILIBILI,
        sec_uid: secUid,
        cookies,
        max_pages: Math.min(Math.max(maxPages ?? 1, 1), MAX_PAGES),
        proxy,
      },
      postsResponseSchema,
    );
    const items: VideoItem[] = [];
    for (const raw of data.videos) {
      const item = toVideoItem(raw);
      if (item) items.push(item);
    }
    return items;
  },

  // M24 批④:listing(vlist)无直链,解读侧现查——网关内 view→cid→playurl;
  // play_url 版权红线仅 job data 过境即焚,禁落库禁分发
  async resolvePlayUrl({ videoId, cookies, proxy }) {
    const data = await gatewayPost(
      "/play-url",
      { platform: VIDEO_PLATFORM_BILIBILI, video_id: videoId, cookies, proxy },
      playUrlResponseSchema,
    );
    return data.play_url ?? null;
  },
};

export async function fetchBilibiliProfile(
  mid: string,
  cookies: string[],
  proxy?: string,
): Promise<{ secUid: string; nickname: string; avatarUrl: string | null }> {
  const data = await gatewayPost(
    "/profile",
    { platform: VIDEO_PLATFORM_BILIBILI, sec_uid: mid, cookies, proxy },
    profileResponseSchema,
  );
  return { secUid: data.sec_uid, nickname: data.nickname, avatarUrl: data.avatar_url ?? null };
}

export async function resolveBilibiliMid(raw: string, proxy?: string): Promise<string> {
  const data = await gatewayPost(
    "/resolve",
    { platform: VIDEO_PLATFORM_BILIBILI, url: raw, proxy },
    resolveResponseSchema,
  );
  return data.sec_uid;
}
