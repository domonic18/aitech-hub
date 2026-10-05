/**
 * 电报流展示视图纯函数(M7 批⑤):客户端/服务端共用,零依赖。
 * 时间口径统一北京时区(与 lib/datetime 同源);条目形态是前台两个消费端
 * (/telegram 时间轴、首页 LIVE 带)与轮询 API 的契约。
 */
import { formatCnTime } from "../datetime";

import { VIDEO_PLATFORM_LABELS } from "./constants";

/** AI 解读结论(M9;仅持久化分析结论——topic/summary/points,无转写文本) */
export interface PublicVideoAi {
  topic: string;
  summary: string;
  points: string[];
  /** 文字条关键词 tag(M12 批⑥ 独立列);视频条恒 null(要点无关键词语义) */
  keywords: string[] | null;
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
  /** ISO;AI 解读完成时刻=条目变可见的时刻(M15 批①:读侧仅出解读终态行)。
   * 轮询增量锚与 NEW 角标基准;展示排序/相对时间仍以 publishedAt 为准 */
  aiRanAt: string;
  sourceId: number;
  sourceName: string;
  /** 源类型(rss/api/web/social-video;渠道章配色按此映射,视频条由 platform 定色) */
  sourceType: string;
  mediaType: "text" | "video";
  video?: PublicVideoMeta;
  /** 文字条轻解读(M12 批③:ai_summary=一句话中心思想、ai_points=要点、
   * ai_keywords=关键词 tag,复用视频 AI 形状字段名不改);视频条的解读在
   * video.ai。null=未解读 */
  ai?: PublicVideoAi | null;
}

/** 媒体筛选合法值(URL 驱动,白名单回落 all) */
export const FEED_MEDIA_FILTERS = ["all", "text", "video"] as const;
export type FeedMediaFilter = (typeof FEED_MEDIA_FILTERS)[number];

/** LIVE 带轮询间隔(取第一页按 id 去重前插;M10 批②起与加载更多共存) */
export const BAND_POLL_MS = 60_000;

/** 平台展示名(未知平台回退原值;标签表在 telegram/constants 零依赖层) */
export function platformLabel(platform: string): string {
  return VIDEO_PLATFORM_LABELS[platform] ?? platform;
}

/** 渠道/平台章色调(原型 site-telegram .src-* / .pf-* 口径,2026-10-05 反馈:
 * 渠道名同色无区分)。视频条按 platform 定色(抖音 amber/小红书 red/B站 blue),
 * 文字条按源类型(rss→accent、web/api→blue、sns→amber);未知回退 neutral。 */
export type FeedChipTone = "neutral" | "accent" | "blue" | "amber" | "red";

const TONE_BY_PLATFORM: Readonly<Record<string, FeedChipTone>> = {
  douyin: "amber",
  xhs: "red",
  bilibili: "blue",
};

const TONE_BY_SOURCE_TYPE: Readonly<Record<string, FeedChipTone>> = {
  rss: "accent",
  web: "blue",
  api: "blue",
  "social-video": "amber",
  sns: "amber",
};

export function feedChipTone(sourceType: string, platform?: string | null): FeedChipTone {
  if (platform) return TONE_BY_PLATFORM[platform.toLowerCase()] ?? "neutral";
  return TONE_BY_SOURCE_TYPE[sourceType] ?? "neutral";
}

/** 色调→章类映射(边框+浅底+彩色字,原型 src/pf 章同款);带/时间轴共用防漂移 */
export const FEED_CHIP_TONE_CLASSES: Readonly<Record<FeedChipTone, string>> = {
  neutral: "border-line bg-panel-2 text-text-2",
  accent: "border-accent/30 bg-accent-dim text-accent",
  blue: "border-blue/30 bg-blue/10 text-blue",
  amber: "border-amber/30 bg-amber/10 text-amber-hi",
  red: "border-red/30 bg-red/10 text-red-hi",
};

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

/** AI 解读投影(镜像 toEngagement;ai_summary 非空才产出,points 白名单截 5 条
 * ——文字要点/关键词 M12 起全量透出,视频要点契约 ≤3 不受影响) */
export function toVideoAi(
  topic: unknown,
  summary: unknown,
  points: unknown,
  keywords: unknown = null,
): PublicVideoAi | null {
  if (typeof summary !== "string" || summary.trim() === "") return null;
  return {
    topic: typeof topic === "string" ? topic.trim() : "",
    summary,
    points: Array.isArray(points)
      ? points.filter((p): p is string => typeof p === "string" && p.trim() !== "").slice(0, 5)
      : [],
    keywords: Array.isArray(keywords)
      ? keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "").slice(0, 5)
      : null,
  };
}

/**
 * 文字条轻解读投影(M12 批③;批⑥ 2026-10-05 验收反馈改双列):要点进 points、
 * 关键词进 keywords。存量兼容:批⑥ 前 done 的文字行是旧契约(ai_points=关键词、
 * ai_keywords 未回填)——keywords 空而 points 非空时对调,旧数据仍显示 tag、
 * 不把关键词当要点充数;重跑「重新生成」即落新契约。
 */
export function toTextAi(
  topic: unknown,
  summary: unknown,
  points: unknown,
  keywords: unknown,
): PublicVideoAi | null {
  const ai = toVideoAi(topic, summary, points, keywords);
  if (!ai) return null;
  const kws = ai.keywords ?? [];
  if (kws.length === 0 && ai.points.length > 0) {
    return { topic: ai.topic, summary: ai.summary, points: [], keywords: ai.points };
  }
  return { topic: ai.topic, summary: ai.summary, points: ai.points, keywords: kws };
}

/** 相对时间(分/小时/天;分钟内「刚刚」) */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 30 分钟内视为新讯(LIVE 带/时间轴 NEW 徽章;基准 aiRanAt,M15 批①) */
export function isNew(iso: string, now = Date.now()): boolean {
  return now - new Date(iso).getTime() < 30 * 60_000;
}

/** 服务端同构排序比较:publishedAt desc,id 数值 desc tiebreak(id 为 BigInt 串,
 * 字典序对跨位数比较失真,转 BigInt 比对);去重后 id 恒异,无相等分支 */
function compareFeedItems(a: PublicTelegramItem, b: PublicTelegramItem): number {
  const t = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  if (t !== 0) return t;
  return BigInt(b.id) >= BigInt(a.id) ? 1 : -1;
}

/**
 * 轮询增量合并(M15 批③):id 去重后按服务端同构序(publishedAt desc,id desc)
 * 重排。「刚解读但发布较早」的行(补扫/backfill 上屏)不错误置顶——纯前插会
 * 破坏倒序不变量,与 listPublicTelegram 的 orderBy 保持一致。
 */
export function mergeFeedItems(
  prev: readonly PublicTelegramItem[],
  fresh: readonly PublicTelegramItem[],
): PublicTelegramItem[] {
  const seen = new Set(prev.map((i) => i.id));
  return [...prev, ...fresh.filter((i) => !seen.has(i.id))].sort(compareFeedItems);
}

/**
 * 未读计数(M15 批③,ai-invest-assisstant 同款未读锚):锚=用户已见的列表首行
 * id,其上条数即未读;锚 null/已被翻页挤出列表(缺失)= 0。中段插入(旧发布
 * 新解读)天然不计——锚下标不变。
 */
export function countUnseen(
  items: readonly PublicTelegramItem[],
  seenTopId: string | null,
): number {
  if (seenTopId === null) return 0;
  const idx = items.findIndex((i) => i.id === seenTopId);
  return idx > 0 ? idx : 0;
}

/** 北京时区 HH:mm(ISO 串入参薄封装;Date 入参用 lib/datetime#formatCnTime) */
export function hhmm(iso: string): string {
  return formatCnTime(new Date(iso));
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
  now = Date.now(),
): Array<{ label: string; items: PublicTelegramItem[] }> {
  const out: Array<{ label: string; items: PublicTelegramItem[] }> = [];
  for (const item of items) {
    const label = dayLabel(item.publishedAt, now);
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
