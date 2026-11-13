/**
 * 视频播放直链现取(M71,K3 复活,arch/04 §3.6):给外部智能体一条可播的直链。
 *
 * 版权红线(arch/02 §3.2):play_url 是平台临时签名 URL(数小时自然失效),
 * **不落库**。本模块按需现查,查得即用、查不得给人话原因,不做持久化。
 * 同 arch/02 的过境纪律:直链只出现在本次响应里,不进日志、不入审计字段。
 *
 * 取链路径按平台分两种(适配器自持,本层只喂料):
 * - douyin:重拉博主最近 3 页 listing,按 videoId 匹配(旧视频超出翻页深度即查不到)
 * - bilibili:网关 /play-url 端点现查(只需 videoId,无需博主身份)
 *
 * videoId 从条目原文 URL 反解(入库时 videoId 只过境 job data,不落库);
 * 博主身份(sec_uid / mid)按「平台行 + 昵称」回 social_account 取。
 */
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

import { ADAPTERS } from "./adapters/video/registry";
import { jarsFromConfig } from "./cookies";
import { getEgressProxyRuntime } from "./egress-proxy";
import type { VideoPlatform } from "./constants";

/** 直链缓存时长:签名 URL 数小时有效,这里取 30 分钟——够 agent 多次取用,
 *  又不至于把已失效的链长期喂出去 */
export const PLAY_URL_CACHE_TTL_SECONDS = 1_800;

const CACHE_PREFIX = "telegram:playurl:v1:";

export interface VideoPlayUrlResult {
  /** 是否取到直链 */
  ok: boolean;
  /** 直链(签名 URL,数小时有效);未取到为 null */
  url: string | null;
  /** 平台作品 id(取链失败时也可能已解出,便于 agent 报障) */
  videoId: string | null;
  platform: string | null;
  /** 未取到的人话原因 */
  reason: string | null;
}

/** 从条目原文 URL 反解平台作品 id:douyin=/video/<数字>,bilibili=/video/<BV 号> */
export function parseVideoId(url: string): string | null {
  const m = /\/video\/([A-Za-z0-9]+)/.exec(url);
  return m ? m[1] : null;
}

/** 缓存键:条目 id(直链按条目取,同一条目多次问同一答案) */
function cacheKey(telegramId: string): string {
  return `${CACHE_PREFIX}${telegramId}`;
}

/**
 * 取直链:先查缓存,未命中现查(网关往返),成功结果写缓存。
 * 任何一步查不得都返回 reason,不抛——外部 agent 拿到的是可解释的失败。
 */
export async function getVideoPlayUrl(telegramId: bigint): Promise<VideoPlayUrlResult> {
  const cached = await redis.get(cacheKey(telegramId.toString())).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as VideoPlayUrlResult;
    } catch {
      // 缓存值损坏:当 miss,继续现查
    }
  }

  const row = await prisma.telegram.findUnique({
    where: { id: telegramId },
    select: {
      id: true,
      mediaType: true,
      url: true,
      sourceId: true,
      videoPlatform: true,
      videoBlogger: true,
    },
  });
  if (!row) {
    return { ok: false, url: null, videoId: null, platform: null, reason: "条目不存在" };
  }
  if (row.mediaType !== "video") {
    return { ok: false, url: null, videoId: null, platform: null, reason: "该条目不是视频" };
  }

  const platform = row.videoPlatform ?? "";
  const adapter = ADAPTERS[platform as VideoPlatform];
  if (!adapter?.resolvePlayUrl) {
    return {
      ok: false,
      url: null,
      videoId: null,
      platform: platform || null,
      reason: `平台 ${platform || "未知"} 不支持直链现查`,
    };
  }

  const videoId = parseVideoId(row.url);
  if (!videoId) {
    return {
      ok: false,
      url: null,
      videoId: null,
      platform,
      reason: "原文链接里解不出作品 id,无法现查直链",
    };
  }

  // 博主身份(sec_uid / mid):按平台行 + 昵称回 social_account;
  // B站直链端点不需要身份,抖音重拉 listing 需要
  const account = row.videoBlogger
    ? await prisma.socialAccount.findFirst({
        where: { platformRowId: row.sourceId, nickname: row.videoBlogger },
        select: { secUid: true },
      })
    : null;
  if (!account && platform !== "bilibili") {
    return {
      ok: false,
      url: null,
      videoId,
      platform,
      reason: "未找到对应博主登记(social_account),无法定位其作品集",
    };
  }

  const platformRow = await prisma.crawlSource.findUnique({
    where: { id: row.sourceId },
    select: { config: true },
  });
  const cookies = jarsFromConfig(platformRow?.config);
  if (cookies.length === 0) {
    return {
      ok: false,
      url: null,
      videoId,
      platform,
      reason: "该平台 Cookie 池为空,网关取链会被风控拒",
    };
  }

  const egress = await getEgressProxyRuntime();
  let url: string | null = null;
  try {
    url = await adapter.resolvePlayUrl({
      videoId,
      secUid: account?.secUid ?? "",
      cookies,
      ...(egress ? { proxy: egress.proxyUrl } : {}),
    });
  } catch (e) {
    logger.warn({
      event: "telegram.play_url.failed",
      telegramId: telegramId.toString(),
      platform,
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      ok: false,
      url: null,
      videoId,
      platform,
      reason: `网关取链失败:${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const result: VideoPlayUrlResult = url
    ? { ok: true, url, videoId, platform, reason: null }
    : {
        ok: false,
        url: null,
        videoId,
        platform,
        reason: "网关未透出直链(作品过旧超出翻页深度,或平台未返回播放地址)",
      };

  if (url) {
    await redis
      .set(
        cacheKey(telegramId.toString()),
        JSON.stringify(result),
        "EX",
        PLAY_URL_CACHE_TTL_SECONDS,
      )
      .catch(() => undefined);
  }
  return result;
}
