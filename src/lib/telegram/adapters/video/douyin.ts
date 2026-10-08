/**
 * 抖音适配器(M8):经 douyin-gateway(Python sidecar)拉博主 listing。
 * 本层只做「HTTP 往返 + Zod 校验 + 异常翻译」——签名/TLS 指纹/jar 冷却
 * 全在网关(research/01 路线 A;契约镜像见 ./gateway-contract,真相源
 * services/douyin-gateway/app/gateway.py)。
 */
import { z } from "zod";

import { VIDEO_PLATFORM_DOUYIN } from "../../constants";
import { env } from "../../../env";

import {
  postsResponseSchema,
  profileResponseSchema,
  resolveResponseSchema,
  gatewayErrorSchema,
  type GatewayVideo,
} from "./gateway-contract";
import {
  GatewayUnavailableError,
  GatewayUpstreamError,
  type VideoAdapter,
  type VideoItem,
} from "./index";

const TIMEOUT_MS = 60_000; // 网关侧含限速重试序列(1+2+5s),放宽到分钟级
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

/** 错误包络 detail 展平(pydantic 422 的 detail 是数组) */
function formatDetail(detail: string | unknown[] | undefined): string {
  if (detail === undefined) return "";
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

/**
 * POST + Zod 校验 + 异常翻译。错误分流按状态码:
 * 503(浏览器槽位未就绪)与网络层故障 → Unavailable(编排层顺延不计失败);
 * 其余非 2xx(404 AccountInvalid/422 校验/502 适配层)→ Upstream(计入连续失败);
 * 2xx 但响应不合契约 → Upstream ContractDrift(漂移必须响,不许静默)。
 */
async function gatewayPost<S extends z.ZodType>(
  path: string,
  payload: unknown,
  schema: S,
): Promise<z.output<S>> {
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
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const errBody = gatewayErrorSchema.safeParse(body);
    const detail = errBody.success ? formatDetail(errBody.data.detail) : "";
    if (res.status === 503) {
      throw new GatewayUnavailableError(detail || "HTTP 503");
    }
    throw new GatewayUpstreamError(
      errBody.success && errBody.data.error ? errBody.data.error : `HTTP ${res.status}`,
      detail,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayUpstreamError("ContractDrift", parsed.error.message);
  }
  return parsed.data;
}

export const douyinAdapter: VideoAdapter = {
  platform: VIDEO_PLATFORM_DOUYIN,

  async fetchRecentVideos({ secUid, cookies, maxPages }) {
    // 翻页上限由编排层传入(常规增量 1,手动回填 3);网关侧 POSTS_MAX_PAGES=3 兜底钳制
    const data = await gatewayPost(
      "/posts",
      {
        sec_uid: secUid,
        cookies,
        max_pages: Math.min(Math.max(maxPages ?? 1, 1), MAX_PAGES),
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
};

export async function fetchDouyinProfile(
  secUid: string,
  cookies: string[],
): Promise<{ secUid: string; nickname: string; avatarUrl: string | null }> {
  const data = await gatewayPost("/profile", { sec_uid: secUid, cookies }, profileResponseSchema);
  return { secUid: data.sec_uid, nickname: data.nickname, avatarUrl: data.avatar_url ?? null };
}

export async function resolveDouyinSecUid(raw: string): Promise<string> {
  const data = await gatewayPost("/resolve", { url: raw }, resolveResponseSchema);
  return data.sec_uid;
}
