/**
 * 信号独立页(/admin/insight/signals/,M59 批A)的筛选钳制与 URL 构造:
 * 纯函数无 React/无 IO,页侧与组件侧共用同一出口(非法值一律丢弃,不抛错)。
 * from/to 按北京日界折算成查询用 Date(from ≥ 当日零点,to < 次日零点),
 * 与总览页历史上的折算口径一致(折算前 from/to 只进 URL 不进查询的坑已修)。
 */
import { parsePage } from "@/lib/admin/list";
import { isRealDay } from "@/lib/datetime";

import { INSIGHT_MEDIA_VOCAB, SIGNAL_REGIONS } from "./constants";
import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "./ingest";

export const SIGNALS_PATH = "/admin/insight/signals/";

export interface SignalFilters {
  source?: InsightSource;
  medium?: string;
  region?: string;
  /** YYYY-MM-DD(北京日) */
  from?: string;
  to?: string;
  page: number;
}

/** 页侧参数钳制(唯一出口):白名单外一律丢弃,页码非法回落 1 */
export function resolveSignalFilters(raw: Record<string, string | undefined>): SignalFilters {
  const sources = [...INSIGHT_SOURCES_ENABLED];
  return {
    source: sources.find((s) => s === raw.source),
    medium: INSIGHT_MEDIA_VOCAB.find((m) => m === raw.medium),
    region: (SIGNAL_REGIONS as readonly string[]).includes(raw.region ?? "")
      ? raw.region
      : undefined,
    from: isRealDay(raw.from) ? raw.from : undefined,
    to: isRealDay(raw.to) ? raw.to : undefined,
    page: parsePage(raw.page),
  };
}

/** 筛选值 → 链接(空值不落串,page>1 才携带;chips 切换时传 {page:1}) */
export function signalsHref(
  filters: SignalFilters,
  overrides: Partial<SignalFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const sp = new URLSearchParams();
  for (const key of ["source", "medium", "region", "from", "to"] as const) {
    const v = merged[key];
    if (v !== undefined && v !== "") sp.set(key, v);
  }
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs === "" ? SIGNALS_PATH : `${SIGNALS_PATH}?${qs}`;
}

/** 日期串 +1 天(纯日历运算,不经时区) */
export function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** 筛选 → 查询时间范围(北京日界:from ≥ 当日 00:00+08,to < 次日 00:00+08) */
export function signalRange(filters: SignalFilters): { from?: Date; to?: Date } {
  return {
    from: filters.from === undefined ? undefined : new Date(`${filters.from}T00:00:00+08:00`),
    to: filters.to === undefined ? undefined : new Date(`${nextDay(filters.to)}T00:00:00+08:00`),
  };
}
