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
