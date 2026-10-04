/**
 * 电报流展示视图纯函数(M7 批⑤):客户端/服务端共用,零依赖。
 * 时间口径统一北京时区(与 lib/datetime 同源);条目形态是前台两个消费端
 * (/telegram 时间轴、首页 LIVE 带)与轮询 API 的契约。
 */

/** AI 解读结论(M9;仅持久化分析结论——topic/summary/points,无转写文本) */
export interface PublicVideoAi {
  topic: string;
  summary: string;
  points: string[];
}

/** 视频条目附加元数据(M8 混合流;mediaType=video 时存在) */
export interface PublicVideoMeta {
  platform: string;
  blogger: string;
  coverUrl: string | null;
  durationSeconds: number | null;
  engagement: { play: number | null; like: number | null; comment: number | null };
  /** M9:LLM 解读结论;null=未解读/解读未产出(前台显隐跟数据走) */
  ai: PublicVideoAi | null;
}

export interface PublicTelegramItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  /** ISO;条目无发布时间时以 createdAt 兜底(服务侧已处理) */
  publishedAt: string;
  sourceId: number;
  sourceName: string;
  mediaType: "text" | "video";
  video?: PublicVideoMeta;
}

/** 媒体筛选合法值(URL 驱动,白名单回落 all) */
export const FEED_MEDIA_FILTERS = ["all", "text", "video"] as const;
export type FeedMediaFilter = (typeof FEED_MEDIA_FILTERS)[number];

/** 首页 LIVE 带条数默认值(M10 起后台可配,存 site_config band.item_count,
 * clamp 1..50;此常量是配置缺行/构建期无库时的兜底,SSR 初值与 60s 轮询同源) */
export const DEFAULT_BAND_ITEM_COUNT = 12;

/** 平台展示名(未知平台回退原值) */
export function platformLabel(platform: string): string {
  const labels: Record<string, string> = { douyin: "抖音", xhs: "小红书", bilibili: "B站" };
  return labels[platform] ?? platform;
}

/** 秒 → m:ss(非法值返回 null,调用方隐藏角标) */
export function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 视频条目来源名:平台·博主(博主名冗余隔离,平台行名 social:* 不出前端) */
export function videoSourceName(video: PublicVideoMeta): string {
  return `${platformLabel(video.platform)} · ${video.blogger}`;
}

/** 互动数紧凑展示(1.2w / 3400;null 忽略) */
export function compactCount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}w`;
  return String(n);
}

/** 互动 JSON 投影(库内形状不受信,逐字段白名单;M8 play 恒 null 隐藏) */
export function toEngagement(raw: unknown): {
  play: number | null;
  like: number | null;
  comment: number | null;
} {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  return { play: num(o.play), like: num(o.like), comment: num(o.comment) };
}

/** AI 解读投影(镜像 toEngagement;ai_summary 非空才产出,points 白名单截 3 条) */
export function toVideoAi(topic: unknown, summary: unknown, points: unknown): PublicVideoAi | null {
  if (typeof summary !== "string" || summary.trim() === "") return null;
  return {
    topic: typeof topic === "string" ? topic.trim() : "",
    summary,
    points: Array.isArray(points)
      ? points.filter((p): p is string => typeof p === "string" && p.trim() !== "").slice(0, 3)
      : [],
  };
}

/** 相对时间(分/小时/天;分钟内「刚刚」) */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 30 分钟内视为新讯(LIVE 带/时间轴 NEW 徽章) */
export function isNew(iso: string, now = Date.now()): boolean {
  return now - new Date(iso).getTime() < 30 * 60_000;
}

/** 北京时区 HH:mm */
export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("sv-SE", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 日分组标签:今天/昨天/YYYY-MM-DD(北京时区) */
export function dayLabel(iso: string, now = Date.now()): string {
  const tz = { timeZone: "Asia/Shanghai" } as const;
  const day = new Date(iso).toLocaleDateString("sv-SE", tz);
  const today = new Date(now).toLocaleDateString("sv-SE", tz);
  if (day === today) return "今天";
  const yesterday = new Date(now - 86_400_000).toLocaleDateString("sv-SE", tz);
  if (day === yesterday) return "昨天";
  return day;
}

/** 相邻同日合并分组(条目已按时间倒序);保序不重排 */
export function groupByDay(
  items: readonly PublicTelegramItem[],
): Array<{ label: string; items: PublicTelegramItem[] }> {
  const out: Array<{ label: string; items: PublicTelegramItem[] }> = [];
  for (const item of items) {
    const label = dayLabel(item.publishedAt);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(item);
    else out.push({ label, items: [item] });
  }
  return out;
}

/** 外链域名展示(非法 URL 返回空串,调用方隐藏该 meta) */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
