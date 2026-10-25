/**
 * F19 健康表渠道行(M48 批E 自 channel-ledger 拆出,≤350 行红线):文字渠道 +
 * 视频平台两组,连败/末次运行原值直出。
 */
import { prisma } from "../db";
import { CRAWL_SOURCE_TYPE_SOCIAL_VIDEO, VIDEO_PLATFORM_LABELS } from "../telegram/constants";
import { listChannelsAdmin } from "../telegram/channels-admin";

/** CrawlSource 无逐渠道错误字段,归因列由页侧显「—」;视频平台行 = 博主聚合
 *  (连败取启用博主最大值,末次运行取最新)。 */
export interface ChannelHealthRow {
  key: string;
  group: "rss" | "video";
  name: string;
  enabled: boolean;
  fails: number;
  lastRunAt: Date | null;
  status: "healthy" | "degraded" | "error" | null;
}

export async function channelHealthRows(): Promise<ChannelHealthRow[]> {
  const [channels, platformRows, bloggers] = await Promise.all([
    listChannelsAdmin(),
    prisma.crawlSource.findMany({
      where: { type: CRAWL_SOURCE_TYPE_SOCIAL_VIDEO },
      orderBy: { id: "asc" },
    }),
    prisma.socialAccount.findMany({
      select: { platform: true, enabled: true, lastRunAt: true, consecutiveFails: true },
    }),
  ]);
  return [
    ...channels.map((c) => ({
      key: `rss-${c.id}`,
      group: "rss" as const,
      name: c.name,
      enabled: c.enabled,
      fails: c.consecutiveFails,
      lastRunAt: c.lastRunAt,
      status: (c.status ?? null) as ChannelHealthRow["status"],
    })),
    ...platformRows.map((p) => {
      const platform = p.platform ?? p.name;
      const mine = bloggers.filter((b) => b.platform === platform);
      return {
        key: `video-${platform}`,
        group: "video" as const,
        name: `${VIDEO_PLATFORM_LABELS[platform] ?? platform}博主采集`,
        enabled: p.enabled,
        fails: Math.max(0, ...mine.filter((b) => b.enabled).map((b) => b.consecutiveFails)),
        lastRunAt: mine.reduce<Date | null>(
          (acc, b) =>
            b.lastRunAt !== null && (acc === null || b.lastRunAt > acc) ? b.lastRunAt : acc,
          null,
        ),
        status: null,
      };
    }),
  ];
}
