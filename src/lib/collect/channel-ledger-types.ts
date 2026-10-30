/**
 * F17 渠道统一台账的行类型与纯展示函数(零 IO,客户端组件可安全引用;
 * 服务端聚合在 ./channel-ledger——拆文件防 prisma/ioredis 拖进浏览器包,
 * 同 collect/schedules 口径)。健康 pill 四态与「最近运行」相对时刻文案
 * 的唯一出口,测试直打本件。
 */
import type { DiscoveryTriggerJob } from "@/lib/discovery/admin";
import { DAY_MS } from "@/lib/datetime";
import { CRAWL_MAX_CONSECUTIVE_FAILS } from "./constants";

export type ChannelKind = "rss" | "video" | "hot" | "discovery" | "github" | "pricing";
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
  kind: ChannelKind;
  name: string;
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
  } | null;
  /** 采集快照时间线入口(牌价渠道;其余类型 null) */
  snapshotsHref: string | null;
}

/** F17 筛选 chips(全部 N / 文字渠道 N / …;GitHub 板面不带计数) */
export const CHANNEL_KIND_TABS: Array<[ChannelKind | "all", string, boolean]> = [
  ["all", "全部", true],
  ["rss", "文字渠道", true],
  ["video", "视频平台", true],
  ["hot", "热榜源", true],
  ["discovery", "发现任务", true],
  ["github", "GitHub", false],
  ["pricing", "牌价渠道", true],
];

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
