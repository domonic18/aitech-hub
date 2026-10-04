/**
 * 视频采集适配器契约(M8):平台无关的富条目形态,B站/小红书后补只加实现文件。
 * 本层只做平台转换——增量/去重/过滤在 ingest-video 编排层,职责不混(同 rss 纪律)。
 */
import type { VideoPlatform } from "../../constants";

/** 视频条目统一形态(title/url 必有;play_url 禁止落库,仅网关调试透出) */
export interface VideoItem {
  /** 平台作品 id(aweme_id 等),外链 URL 的稳定锚 */
  videoId: string;
  title: string;
  /** 口播描述全文(摘要候选;标题取首行在编排层做) */
  caption: string | null;
  url: string;
  publishedAt: Date | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  engagement: { play: number | null; like: number | null; comment: number | null };
  topicTags: string[];
}

/** 博主 listing 拉取输入:身份 sec_uid + 平台级明文 jar 池(网关零密钥) */
export interface VideoFetchInput {
  secUid: string;
  cookies: string[];
}

export interface VideoAdapter {
  readonly platform: VideoPlatform;
  /** 拉取博主最新作品一页(增量/翻页由编排层决定是否续拉) */
  fetchRecentVideos(input: VideoFetchInput): Promise<VideoItem[]>;
}

/** 网关不可达/超时等基础设施故障(编排层不计博主连续失败) */
export class GatewayUnavailableError extends Error {
  constructor(detail: string) {
    super(`抖音网关不可达: ${detail}`);
    this.name = "GatewayUnavailableError";
  }
}

/** 网关在线但上游失败(error 字段归因;编排层计入博主连续失败) */
export class GatewayUpstreamError extends Error {
  constructor(
    readonly kind: string,
    detail: string,
  ) {
    super(`${kind}: ${detail}`);
    this.name = "GatewayUpstreamError";
  }
}
