/**
 * F17 渠道统一台账的行类型与纯展示函数(零 IO,客户端组件可安全引用;
 * 服务端聚合在 ./channel-ledger——拆文件防 prisma/ioredis 拖进浏览器包,
 * 同 collect/schedules 口径)。健康 pill 四态与「最近运行」相对时刻文案
 * 的唯一出口,测试直打本件。
 */
import type { DiscoveryTriggerJob } from "@/lib/discovery/admin";
import { DAY_MS } from "@/lib/datetime";
import { CRAWL_MAX_CONSECUTIVE_FAILS } from "./constants";

/** 台账分组(2026-10-30 按采集计划板口径分节展示):文字类源按 crawl_source.type
 * 细分(vendor/leaderboard/community 各有独立管线,不合并在 RSS 里),其余按行族 */
export type ChannelGroup =
  | "rss"
  | "vendor"
  | "leaderboard"
  | "community"
  | "pricing"
  | "video"
  | "hot"
  | "discovery"
  | "github";
export type LedgerHealth = "healthy" | "fail" | "degraded" | "paused";

/** 主钮(手动触发列第一位;running = 呈现「● 采集中 mm:ss」替代按钮) */
export type LedgerPrimaryAction =
  | { type: "crawl"; channelId: number }
  | { type: "crawlBloggers"; bloggerIds: number[] }
  | { type: "hotboard" }
  | { type: "discover"; job: DiscoveryTriggerJob }
  | { type: "syncGithub"; repoIds: number[] }
  | { type: "running"; sinceMs: number };

/** 次钮:文字渠道 = 试拉/调试(不入库验连通);其余 = 站内跳转 */
export type LedgerSecondaryAction =
  | { type: "debug"; channelId: number; label: string }
  | { type: "link"; href: string; label: string };

export interface ChannelLedgerRow {
  key: string;
  group: ChannelGroup;
  /** 渠道标识(crawl_source.name 原值;台账上「vendor:anthropic」这类内部键
   * 靠备注列解释用途),其余行族为展示名 */
  name: string;
  /** 备注(源管理可维护;registry 渠道由种子按注册表 label 落库;无 = null) */
  remark: string | null;
  cadence: string;
  enabled: boolean;
  health: LedgerHealth;
  healthText: string;
  lastRunLabel: string;
  /** 自动调度开关端点(发现任务/GitHub 聚合行无开关 → null) */
  statusEndpoint: string | null;
  primary: LedgerPrimaryAction;
  secondary: LedgerSecondaryAction | null;
  /** 文字渠道行编辑弹窗载荷(板「编辑」入口收进渠道名格;其余类型 null) */
  editChannel: {
    id: number;
    name: string;
    type: string;
    platform: string | null;
    url: string;
    crawlIntervalMin: number;
    dailyMaxRequests: number | null;
    remark: string | null;
    enabled: boolean;
    credentialMask: string;
    /** 扩展配置 JSON 预填(凭证键已剔除;空串=无) */
    configJson: string;
  } | null;
  /** 采集快照时间线入口(牌价渠道;其余类型 null) */
  snapshotsHref: string | null;
}

/** 分组元信息(组头标签 + 色点;色值对齐设计令牌家族,与 PLAN_GROUPS 同形态) */
export const CHANNEL_GROUPS: Record<ChannelGroup, { label: string; color: string }> = {
  rss: { label: "资讯 RSS", color: "#5e6ad2" },
  vendor: { label: "厂商动态", color: "#db61a2" },
  leaderboard: { label: "榜单", color: "#d29922" },
  community: { label: "社区语料", color: "#3fb950" },
  pricing: { label: "牌价渠道", color: "#58a6ff" },
  video: { label: "视频平台", color: "#bc4cff" },
  hot: { label: "热榜源", color: "#f85149" },
  discovery: { label: "发现任务", color: "#2ea043" },
  github: { label: "GitHub 项目源", color: "#8a8f98" },
};

/** 组序 = 板面序(文字类源 → 牌价 → 视频 → 热榜 → 发现 → GitHub) */
export const CHANNEL_GROUP_ORDER = Object.keys(CHANNEL_GROUPS) as ChannelGroup[];

/** F17 筛选 chips:全部 + 各分组 1:1(点组名即只看该组) */
export const CHANNEL_GROUP_TABS: Array<[ChannelGroup | "all", string]> = [
  ["all", "全部"],
  ...CHANNEL_GROUP_ORDER.map((g) => [g, CHANNEL_GROUPS[g].label] as [ChannelGroup, string]),
];

/** crawl_source.type → 台账分组(rss/web/api 合并为「资讯 RSS」;其余 registry
 * 类型各自成组;未知值按文字源兜底——合法值由创建 Zod 约束) */
export function channelGroupOfType(type: string): ChannelGroup {
  if (type === "vendor" || type === "leaderboard" || type === "community" || type === "pricing") {
    return type;
  }
  return "rss";
}

/** 健康 pill 四态(板 ●健康/●故障·连败 N/●降级·限频/○暂停):文字渠道以
 *  crawl_source.status 字段为准,无状态字段的行(热榜/GitHub)按连败数推 */
export function healthOf(
  enabled: boolean,
  fails: number,
  status: "healthy" | "error" | "degraded" | null,
): { health: LedgerHealth; healthText: string } {
  if (!enabled) return { health: "paused", healthText: "暂停" };
  if (status === "error" || fails >= CRAWL_MAX_CONSECUTIVE_FAILS)
    return { health: "fail", healthText: `故障·连败 ${fails}` };
  if (status === "degraded") return { health: "degraded", healthText: "降级·限频" };
  if (fails > 0) return { health: "degraded", healthText: `降级·连败 ${fails}` };
  return { health: "healthy", healthText: "健康" };
}

function hhmmCn(at: Date): string {
  return at.toLocaleTimeString("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfCnDay(at: Date): Date {
  const day = at.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  return new Date(`${day}T00:00:00+08:00`);
}

/** 「HH:mm · N 条」;今日只显时刻,往日带相对天数(板「09:12 · 12 条 / 3 天前 · 0 条」);
 *  count = null 时只出时刻段(发现任务摘要缺新词数不硬凑) */
export function lastRunLabel(at: Date | null, count: number | null, unit: string): string {
  if (at === null) return "—";
  const days = Math.round(
    (startOfCnDay(new Date()).getTime() - startOfCnDay(at).getTime()) / DAY_MS,
  );
  const atText = days <= 0 ? hhmmCn(at) : days === 1 ? `昨天 ${hhmmCn(at)}` : `${days} 天前`;
  return count === null ? atText : `${atText} · ${count} ${unit}`;
}

export function intervalText(min: number): string {
  if (min >= 1440 && min % 1440 === 0) return `每 ${min / 1440} 天`;
  if (min >= 60 && min % 60 === 0) return `每 ${min / 60} 小时`;
  return `每 ${min} 分钟`;
}
