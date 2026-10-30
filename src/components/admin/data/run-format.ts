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

function numOf(summary: unknown, key: string): number | null {
  if (summary === null || summary === undefined || typeof summary !== "object") return null;
  const v = (summary as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

/** 采集任务(crawler/crawl)计数:入库优先、为 0 退抓取——registry 渠道
 * (vendor/leaderboard/community)产出落信号池/榜单表,电报入库恒 0,
 * 只看 inserted 会让「采集到了」显示成 0 */
export function crawlCount(summary: unknown): number | null {
  const inserted = numOf(summary, "inserted");
  const fetched = numOf(summary, "fetched");
  if (inserted !== null && inserted > 0) return inserted;
  return fetched ?? inserted;
}

/** crawler/crawl 说明列人话单行:渠道名 · 抓取 N[· 去重 M][· 主题外 K]
 * [· 超日上限顺延];无渠道名(旧记录)返回 null 走通用 JSON 截头 */
export function crawlSummaryLine(summary: unknown): string | null {
  if (summary === null || summary === undefined || typeof summary !== "object") return null;
  const rec = summary as Record<string, unknown>;
  const name = typeof rec.sourceName === "string" ? rec.sourceName : null;
  if (name === null) return null;
  const parts = [`抓取 ${numOf(summary, "fetched") ?? 0}`];
  const duplicated = numOf(summary, "duplicated");
  if (duplicated !== null && duplicated > 0) parts.push(`去重 ${duplicated}`);
  const topicSkipped = numOf(summary, "topicSkipped");
  if (topicSkipped !== null && topicSkipped > 0) parts.push(`主题外 ${topicSkipped}`);
  if (rec.skippedDailyCap === true) parts.push("超日上限顺延");
  return `${name} · ${parts.join(" · ")}`;
}
