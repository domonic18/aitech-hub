/**
 * 站点统一时区口径:受众以国内为主,展示与统计日界均按 Asia/Shanghai。
 * 统计日聚合(requirement §3.5)与页面日期展示共用同一函数,避免两侧口径漂移。
 */
export function formatCnDate(date: Date): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 当前统计日(YYYY-MM-DD,北京时区) */
export function statsDay(now: Date = new Date()): string {
  return formatCnDate(now);
}
