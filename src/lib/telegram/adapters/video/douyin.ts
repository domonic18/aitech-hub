/**
 * 抖音适配器(M8):经 douyin-gateway(Python sidecar)拉博主 listing。
 * 本层只做「HTTP 往返 + 异常翻译」——签名/TLS 指纹/jar 冷却全在网关
 * (research/01 路线 A;网关契约见 douyin-gateway/app/gateway.py)。
 */
import { VIDEO_PLATFORM_DOUYIN } from "../../constants";
import { env } from "../../../env";

import {
  GatewayUnavailableError,
  GatewayUpstreamError,
  type VideoAdapter,
  type VideoItem,
} from "./index";

const TIMEOUT_MS = 60_000; // 网关侧含限速重试序列(1+2+5s),放宽到分钟级
const MAX_PAGES = 3;

/** 网关 /posts 归一化投影(与 douyin-gateway VideoOut 对齐) */
interface GatewayVideo {
  video_id: string;
  caption: string | null;
  topic_tags?: string[];
  cover_url?: string | null;
  play_url?: string | null; // 仅日志调试,禁止落库(版权红线)
  duration_seconds?: number | null;
  published_at?: string | null;
  digg_count?: number | null;
  comment_count?: number | null;
  share_count?: number | null;
}

interface GatewayPostsResponse {
  videos: GatewayVideo[];
  has_more: boolean;
  max_cursor: number;
}

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
    topicTags: Array.isArray(raw.topic_tags) ? raw.topic_tags : [],
  };
}

async function gatewayPost<T>(path: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.DOUYIN_GATEWAY_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GatewayUnavailableError(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
    // 网关把适配层异常归因为 {error, detail};连接级/非 JSON 一律基础设施故障
    if (body?.error) throw new GatewayUpstreamError(body.error, body.detail ?? "");
    throw new GatewayUnavailableError(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const douyinAdapter: VideoAdapter = {
  platform: VIDEO_PLATFORM_DOUYIN,

  async fetchRecentVideos({ secUid, cookies, maxPages }) {
    // 翻页上限由编排层传入(常规增量 1,手动回填 3);网关侧 POSTS_MAX_PAGES=3 兜底钳制
    const data = await gatewayPost<GatewayPostsResponse>("/posts", {
      sec_uid: secUid,
      cookies,
      max_pages: Math.min(Math.max(maxPages ?? 1, 1), MAX_PAGES),
    });
    const items: VideoItem[] = [];
    for (const raw of data.videos ?? []) {
      const item = toVideoItem(raw);
      if (item) items.push(item);
    }
    return items;
  },
};

export async function fetchDouyinProfile(
  secUid: string,
  cookies: string[],
): Promise<{ secUid: string; nickname: string; avatarUrl: string | null }> {
  const data = await gatewayPost<{
    sec_uid: string;
    nickname: string;
    avatar_url: string | null;
  }>("/profile", { sec_uid: secUid, cookies });
  return { secUid: data.sec_uid, nickname: data.nickname, avatarUrl: data.avatar_url ?? null };
}

export async function resolveDouyinSecUid(raw: string): Promise<string> {
  const data = await gatewayPost<{ sec_uid: string }>("/resolve", { url: raw });
  return data.sec_uid;
}
