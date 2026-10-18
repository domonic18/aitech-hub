/**
 * 洞察趋势读侧(M34 批③ 验收反馈·可视化增强):近 7 日分源日增序列 +
 * 近 7 日×24 小时时段热力。北京时区切桶(to_char/extract 显式 AT TIME ZONE,
 * 不依赖进程/库时区);恒限在役源白名单;缺桶补 0 交渲染层直用。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";

import { INSIGHT_SOURCES_ENABLED } from "./ingest";

const ENABLED = [...INSIGHT_SOURCES_ENABLED];
const DAY_MS = 86_400_000;

export interface InsightTrendDay {
  /** 北京日 YYYY-MM-DD(旧→新,含今日) */
  date: string;
  /** 源→条数(未命中源=0) */
  bySource: Record<string, number>;
}

export interface InsightHourCell {
  /** PG dow:0=周日(矩阵行序由调用方定,本函数按周一→周日输出) */
  dow: number;
  hour: number;
  count: number;
}

/** 近 7 日起点(北京今日零点往前 6 天,与 admin.ts 同口径) */
function weekStart(now: Date = new Date()): Date {
  const start = new Date(`${statsDay(now)}T00:00:00+08:00`);
  return new Date(start.getTime() - 6 * DAY_MS);
}

/** 北京日字符串序列(纯日期串运算,锚 statsDay 避开时区偏移陷阱;旧→新含今日) */
function beijingDayKeys(now: Date = new Date()): string[] {
  const [y, m, d] = statsDay(now).split("-").map(Number);
  const anchorUtc = Date.UTC(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(anchorUtc - (6 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

/** 近 7 日分源日增(含今日,缺日/缺源补 0;北京日界) */
export async function insightTrendDaily(now: Date = new Date()): Promise<InsightTrendDay[]> {
  const rows = await prisma.$queryRaw<{ d: string; source: string; c: bigint }[]>`
    SELECT to_char(signal_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS d,
           source, count(*) AS c
      FROM insight_signal
     WHERE signal_at >= ${weekStart(now)} AND source IN (${Prisma.join(ENABLED)})
     GROUP BY 1, 2
  `;
  const byDaySource = new Map(rows.map((r) => [`${r.d}|${r.source}`, Number(r.c)]));
  return beijingDayKeys(now).map((date) => {
    const bySource: Record<string, number> = {};
    for (const s of ENABLED) bySource[s] = byDaySource.get(`${date}|${s}`) ?? 0;
    return { date, bySource };
  });
}

/** 近 7 日×24 小时信号热力(北京墙钟;周一→周日 × 0-23 时,缺桶补 0,168 格) */
export async function insightHourHeat(now: Date = new Date()): Promise<InsightHourCell[]> {
  const rows = await prisma.$queryRaw<{ dow: number; hour: number; c: bigint }[]>`
    SELECT extract(dow FROM signal_at AT TIME ZONE 'Asia/Shanghai')::int AS dow,
           extract(hour FROM signal_at AT TIME ZONE 'Asia/Shanghai')::int AS hour,
           count(*) AS c
      FROM insight_signal
     WHERE signal_at >= ${weekStart(now)} AND source IN (${Prisma.join(ENABLED)})
     GROUP BY 1, 2
  `;
  const bySlot = new Map(rows.map((r) => [`${r.dow}|${r.hour}`, Number(r.c)]));
  const cells: InsightHourCell[] = [];
  for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ dow, hour, count: bySlot.get(`${dow}|${hour}`) ?? 0 });
    }
  }
  return cells;
}
