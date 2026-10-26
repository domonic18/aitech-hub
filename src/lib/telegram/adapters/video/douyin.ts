/**
 * 抖音适配器(M8):经 douyin-gateway(Python sidecar)拉博主 listing。
 * 本层只做「HTTP 往返 + Zod 校验 + 异常翻译」——签名/TLS 指纹/jar 冷却
 * 全在网关(research/01 路线 A;契约镜像见 ./gateway-contract,真相源
 * services/douyin-gateway/app/gateway.py)。HTTP 公共层见 ./gateway-http。
 */
import { VIDEO_PLATFORM_DOUYIN } from "../../constants";

import {
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
  // 标题取口播描述首行(与上游 DouyinVideo.title 同口径)
  const title = caption?.split("\n")[0].trim() || caption || "";
  // 外链用 canonical 稳定形(www.douyin.com/video/{id}),与分享短链解耦
  return {
    videoId: raw.video_id,
    title,
    caption,
    url: `https://www.douyin.com/video/${raw.video_id}`,
    publishedAt: raw.published_at ? new Date(raw.published_at) : null,
    coverUrl: raw.cover_url ?? null,
    durationSeconds: raw.duration_seconds ?? null,
    // 播放量 aweme statistics 不稳定给,置 null 前台隐藏(like=digg_count)
    engagement: {
      play: null,
      like: raw.digg_count ?? null,
      comment: raw.comment_count ?? null,
    },
    topicTags: raw.topic_tags,
    // 网关透出的无水印直链仅在此过境(解读管道消费),落库禁令在 ingest 层钉
    playUrl: raw.play_url ?? null,
  };
}

export const douyinAdapter: VideoAdapter = {
  platform: VIDEO_PLATFORM_DOUYIN,

  async fetchRecentVideos({ secUid, cookies, maxPages, proxy }) {
    // 翻页上限由编排层传入(常规增量 1,手动回填 3);网关侧 POSTS_MAX_PAGES=3 兜底钳制
    const data = await gatewayPost(
      "/posts",
      {
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

  // M24 批②收编 interpret-video fetchFreshPlayUrl 的 listing 匹配(行为不变):
  // 翻页拉满(存量补读可能要翻 3 页),按 videoId 匹配取网关透传直链
  async resolvePlayUrl({ videoId, secUid, cookies, proxy }) {
    const items = await this.fetchRecentVideos({ secUid, cookies, maxPages: MAX_PAGES, proxy });
    return items.find((it) => it.videoId === videoId)?.playUrl ?? null;
  },
};

export async function fetchDouyinProfile(
  secUid: string,
  cookies: string[],
  proxy?: string,
): Promise<{ secUid: string; nickname: string; avatarUrl: string | null }> {
  const data = await gatewayPost(
    "/profile",
    { sec_uid: secUid, cookies, proxy },
    profileResponseSchema,
  );
  return { secUid: data.sec_uid, nickname: data.nickname, avatarUrl: data.avatar_url ?? null };
}

export async function resolveDouyinSecUid(raw: string, proxy?: string): Promise<string> {
  const data = await gatewayPost("/resolve", { url: raw, proxy }, resolveResponseSchema);
  return data.sec_uid;
}
