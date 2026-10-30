/**
 * 站点统一时区口径:受众以国内为主,展示与统计日界均按 Asia/Shanghai。
 * 统计日聚合(requirement §3.5)与页面日期展示共用同一函数,避免两侧口径漂移。
 * 红线:展示/调度一律显式传本模块(或 SITE_TZ),不得依赖进程 TZ——
 * 镜像 ENV TZ=Asia/Shanghai 仅作兜底,换运行环境(UTC 容器/serverless)即偏 8 小时。
 */
export const SITE_TZ = "Asia/Shanghai";

export function formatCnDate(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: SITE_TZ });
}

/** 日期时间展示(后台列表用):YYYY-MM-DD HH:mm,北京时区,与 formatCnDate 同口径 */
export function formatCnDateTime(date: Date): string {
  return date.toLocaleString("sv-SE", { timeZone: SITE_TZ }).slice(0, 16);
}

/** 时间展示(时:分,北京时区):电报流条目行/采集观测时间轴共用 */
export function formatCnTime(date: Date): string {
  return date.toLocaleTimeString("sv-SE", {
    timeZone: SITE_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 当前统计日(YYYY-MM-DD,北京时区) */
export function statsDay(now: Date = new Date()): string {
  return formatCnDate(now);
}

/**
 * 今日起点(北京时区零点对应的 UTC 时刻):「当日」口径计数(分发中心
 * 今日分发 KPI 等)用。Asia/Shanghai 1991 年后无夏令时,固定 +08:00。
 */
export function startOfCnDay(now: Date = new Date()): Date {
  return new Date(`${formatCnDate(now)}T00:00:00+08:00`);
}

/**
 * URL/表单来的 YYYY-MM-DD 是否**真实存在**的日历日:2026-13-45 折成 Invalid Date
 * 会让查询直接 500,2026-02-30 会被 Date 静默进位成 3-2 筛出别的范围——两者都要在
 * 参数钳制处丢弃(2026-10-30 信号页/事件页实测)。
 */
export function isRealDay(v: string | undefined): v is string {
  if (v === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 相对时间(F16 渠道卡「最近同步:N 分钟/小时/天前」;<1 分钟显「刚刚」,超 7 天回落绝对日期) */
export function formatCnRelative(date: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return formatCnDate(date);
}

/** 当前统计月(YYYY-MM,北京时区):Token 月度额度 periodKey 同源口径(M22) */
export function statsMonth(now: Date = new Date()): string {
  return statsDay(now).slice(0, 7);
}

/** 日序列运算步长(86400000ms;切桶只用,勿当时差换算用) */
export const DAY_MS = 86_400_000;

/** 北京日串(YYYY-MM-DD)→ UTC 锚点毫秒(M48 批F 单源:insight trends/admin
 * 日序列切桶样板共用的解析核;只作序列运算锚,不是任何真实时刻,严禁当时刻用) */
export function cnDayAnchorMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 北京日串序列(旧→新):以 anchorDay 为含端点——back=向前数 count 天且收尾于
 * anchor(近 7 日含今日);fwd=自 anchor 起向后 count 天(窗口起点日起) */
export function cnDayKeyRange(anchorDay: string, count: number, dir: "back" | "fwd"): string[] {
  const anchor = cnDayAnchorMs(anchorDay);
  return Array.from({ length: count }, (_, i) =>
    new Date(dir === "back" ? anchor - (count - 1 - i) * DAY_MS : anchor + i * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );
}
