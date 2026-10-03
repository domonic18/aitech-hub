/**
 * 电报流展示视图纯函数(M7 批⑤):客户端/服务端共用,零依赖。
 * 时间口径统一北京时区(与 lib/datetime 同源);条目形态是前台两个消费端
 * (/telegram 时间轴、首页 LIVE 带)与轮询 API 的契约。
 */

export interface PublicTelegramItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  /** ISO;条目无发布时间时以 createdAt 兜底(服务侧已处理) */
  publishedAt: string;
  sourceId: number;
  sourceName: string;
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
