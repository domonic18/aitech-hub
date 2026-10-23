/**
 * 运行页(日志/健康页签)共享小格式化(验收二批③):Date → 北京时间短格式、
 * 耗时人话(毫秒/秒/分秒)。纯函数,两端组件共用。
 */

/** 北京时间短格式(MM-dd HH:mm) */
export function fmtTime(date: Date): string {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 耗时人话:723ms / 3.4s / 2m5s */
export function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** F18「入库」数:摘要 JSON 里首个数值型产出字段(inserted/fetched/count/items/
 * total/words/signals);无则 null——不硬凑计数。 */
export function summaryInserted(summary: unknown): number | null {
  if (summary === null || summary === undefined || typeof summary !== "object") return null;
  const rec = summary as Record<string, unknown>;
  for (const key of ["inserted", "fetched", "count", "items", "total", "words", "signals"]) {
    const v = rec[key];
    if (typeof v === "number") return v;
  }
  return null;
}
