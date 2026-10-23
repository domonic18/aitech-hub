/**
 * F21/F22 计划页纯展示层:六业务分组、行类型与时刻推导(cron 未来 3 次/
 * 间隔行推进/最近运行与下次执行文案)。零 IO——客户端计划板与服务端聚合
 * (plan-rows.ts)同源引用,防 prisma/ioredis 拖进浏览器包(同
 * channel-ledger-types 拆法)。文案在服务端预格式化为字符串下发,避免
 * 「今天/明天」日界在客户端水合时漂移。
 */
import { formatCnTime, startOfCnDay } from "../datetime";
import { intervalText } from "./channel-ledger-types";
import { DOW_LABELS_CN, type CronParsed } from "./schedules";

export type PlanGroup = "rss" | "hot" | "social" | "discovery" | "analysis" | "maint";

/** F22 分类 legend 六色(设计令牌原值;替代旧 SCHEDULE_CATEGORIES 四类口径) */
export const PLAN_GROUPS: Record<PlanGroup, { label: string; color: string }> = {
  rss: { label: "资讯 RSS", color: "#5e6ad2" },
  hot: { label: "热榜", color: "#d29922" },
  social: { label: "社媒", color: "#bc4cff" },
  discovery: { label: "发现", color: "#2ea043" },
  analysis: { label: "分析", color: "#db61a2" },
  maint: { label: "维护", color: "#8a8f98" },
};

export interface PlanRow {
  key: string;
  group: PlanGroup;
  name: string;
  cadence: string;
  /** 「今天 14:30 · 15:00 · 15:30」(未来 3 次,服务端预格式化;停用行为「—」) */
  nextText: string;
  enabled: boolean;
  running: boolean;
  /** 「2 分钟前 · 成功」/「运行中 · 已 2m 31s」;null = 无落账 */
  lastRun: { text: string; ok: boolean } | null;
  links: { edit?: string; logs?: string; live?: string };
}

/** F22 日历条目(周网格落格 / 日时间线 / 月密度共用;服务端预推导) */
export interface PlanCalEntry {
  key: string;
  group: PlanGroup;
  label: string;
  /** chip 后缀:「每 30 分钟」「每小时 :43」「05:37 / 06:13」 */
  cadence: string;
  /** 周网格落格小时(08-20 时间窗内首个触发档);null = 时间窗外 → footnote */
  weekHour: number | null;
  /** PG dow 口径;null = 每日 */
  days: number[] | null;
  enabled: boolean;
  /** 月视图密度:日均触发次数 */
  firesPerDay: number;
  /** 日视图展开时刻;null = 循环型(间隔/hourly,不展开时刻) */
  times: string[] | null;
}

/** 周网格时间窗(F22 板定 08:00-20:00) */
export const CAL_WINDOW = { lo: 8, hi: 20 } as const;

// ── 时刻推导(纯) ─────────────────────────────────────────────────────────────

/** cron 未来 N 次(北京时间;CN 无夏令时,天序循环逐日 +24h 即可) */
export function nextCronRuns(parsed: CronParsed, count: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  const base = startOfCnDay(from).getTime();
  const minuteSlots = parsed.times.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  for (let i = 0; i < 15 && out.length < count; i += 1) {
    // 15 天覆盖「周一错过后再下一周一」
    const dayStart = base + i * 86_400_000;
    const dow = new Date(dayStart + 8 * 3_600_000).getUTCDay(); // CN 墙钟星期
    if (parsed.days !== null && !parsed.days.includes(dow)) continue;
    // hourly(分钟档 × 通配小时)展开全天 24 档;单时刻档即原时刻
    const slots = parsed.hourly
      ? Array.from({ length: 24 }, (_, h) => minuteSlots.map((m) => h * 60 + m)).flat()
      : minuteSlots;
    for (const s of [...slots].sort((a, b) => a - b)) {
      const fire = new Date(dayStart + s * 60_000);
      if (fire > from) {
        out.push(fire);
        if (out.length >= count) break;
      }
    }
  }
  return out;
}

/** 间隔行未来 N 次:从 nextRunAt 起步(落后现刻先追平一个周期),步进 interval */
export function nextIntervalRuns(
  nextRunAt: Date | null,
  intervalMin: number,
  count: number,
  from: Date = new Date(),
): Date[] {
  if (nextRunAt === null) return [];
  let t = nextRunAt.getTime();
  while (t <= from.getTime()) t += intervalMin * 60_000;
  return Array.from({ length: count }, (_, i) => new Date(t + i * intervalMin * 60_000));
}

/** F21「下次执行」格:首条带 今天/明天/后天/周X 前缀,同日续条只补时刻(板例) */
export function formatNextRuns(runs: Date[], from: Date = new Date()): string {
  if (runs.length === 0) return "—";
  const today = startOfCnDay(from).getTime();
  let lastDay = -1;
  return runs
    .map((r) => {
      const day = startOfCnDay(r).getTime();
      const days = Math.round((day - today) / 86_400_000);
      const dow = DOW_LABELS_CN[new Date(r.getTime() + 8 * 3_600_000).getUTCDay()];
      const prefix =
        day === lastDay
          ? ""
          : days <= 0
            ? "今天 "
            : days === 1
              ? "明天 "
              : days === 2
                ? "后天 "
                : `${dow} `;
      lastDay = day;
      return `${prefix}${formatCnTime(r)}`;
    })
    .join(" · ");
}

/** F21「最近运行」格:运行中耗时秒表 / 相对时刻 · 成败(板「2 分钟前 · 成功」) */
export function formatLastRun(
  lastRunAt: Date | null,
  ok: boolean,
  runningSinceMs: number | null,
  from: Date = new Date(),
): string | null {
  if (runningSinceMs !== null) {
    const s = Math.max(0, Math.floor((from.getTime() - runningSinceMs) / 1000));
    return `运行中 · 已 ${Math.floor(s / 60)}m ${s % 60}s`;
  }
  if (lastRunAt === null) return null;
  const minutes = Math.floor((from.getTime() - lastRunAt.getTime()) / 60_000);
  let when: string;
  if (minutes < 60) {
    when = `${Math.max(1, minutes)} 分钟前`;
  } else {
    const days = Math.round(
      (startOfCnDay(from).getTime() - startOfCnDay(lastRunAt).getTime()) / 86_400_000,
    );
    const time = formatCnTime(lastRunAt);
    when =
      days <= 0
        ? `今天 ${time}`
        : days === 1
          ? `昨天 ${time}`
          : days < 7
            ? `${DOW_LABELS_CN[new Date(lastRunAt.getTime() + 8 * 3_600_000).getUTCDay()]} ${time}`
            : time;
  }
  return `${when} · ${ok ? "成功" : "失败"}`;
}

/** cron 行节奏文案(板口径):「每 15 分钟」/「每小时 :43」/「每日 05:37」/「周一 06:13」 */
export function cadenceLabel(parsed: CronParsed): string {
  if (parsed.hourly) {
    return parsed.times.length > 1
      ? `每 ${Math.round(60 / parsed.times.length)} 分钟`
      : `每小时 :${parsed.times[0]?.slice(3) ?? "00"}`;
  }
  const dayText =
    parsed.days === null ? "每日" : parsed.days.map((d) => DOW_LABELS_CN[d]).join("/");
  return `${dayText} ${parsed.times.join(" / ")}`;
}

// ── 日历条目构造(纯;plan-rows 服务端装配调用) ──────────────────────────────

/** 间隔行(渠道/博主平台):周窗代表档由相位推进扫描(96 档覆盖 ≥2 天) */
export function intervalCal(input: {
  key: string;
  group: PlanGroup;
  label: string;
  intervalMin: number;
  nextRunAt: Date | null;
  enabled: boolean;
  /** 推导基准(缺省 = 现在时;测试传固定值保确定) */
  from?: Date;
}): PlanCalEntry {
  const { key, group, label, intervalMin, nextRunAt, enabled, from } = input;
  let weekHour: number | null = null;
  if (enabled && nextRunAt !== null) {
    for (const t of nextIntervalRuns(nextRunAt, intervalMin, 96, from)) {
      const h = new Date(t.getTime() + 8 * 3_600_000).getUTCHours();
      if (h >= CAL_WINDOW.lo && h <= CAL_WINDOW.hi) {
        weekHour = h;
        break;
      }
    }
  }
  return {
    key,
    group,
    label,
    cadence: intervalText(intervalMin),
    weekHour,
    days: null,
    enabled,
    firesPerDay: Math.max(1, Math.round(1440 / intervalMin)),
    times: null,
  };
}

/** cron 行(hourly 视作循环型,不展开 24 档时刻;全窗外 → weekHour null) */
export function cronCal(input: {
  key: string;
  group: PlanGroup;
  label: string;
  parsed: CronParsed;
  enabled: boolean;
}): PlanCalEntry {
  const { key, group, label, parsed, enabled } = input;
  const slots = parsed.hourly
    ? Array.from({ length: 24 }, (_, h) => h)
    : parsed.times.map((t) => Number(t.slice(0, 2)));
  return {
    key,
    group,
    label,
    cadence: cadenceLabel(parsed),
    weekHour: slots.find((h) => h >= CAL_WINDOW.lo && h <= CAL_WINDOW.hi) ?? null,
    days: parsed.days,
    enabled,
    firesPerDay: parsed.firesPerDay,
    times: parsed.hourly ? null : parsed.times,
  };
}
