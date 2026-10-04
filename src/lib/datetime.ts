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
