/**
 * AI 用量看板读侧(M14 批⑦,验收反馈问题8):ai_usage_log 按窗口聚合出
 * KPI(tokens/费用/ASR/降级)、CN 日趋势、按任务与按模型分布、明细行(含 14 点趋势)。
 * 费用读时按牌价现折算(牌价改动即重算,不落库):LLM= tokens × ¥/1M、
 * ASR= 音频秒 × ¥/h 按秒比例、生图= 行数 × ¥/张;failed 行不计费。
 * 日界与统计口径全站统一 Asia/Shanghai(datetime.ts 红线)。
 */
import { prisma } from "../db";
import { formatCnDate } from "../datetime";
import { ASR_CONFIG_ID } from "./asr-admin";
import { AI_USAGE_ROLE_ASR } from "./usage-log";

const COVER_ROLE = "cover";
/** 明细行趋势点数(原型 30 日趋势 spark) */
const SPARK_BUCKETS = 14;
/** CN 日毫秒(中国无夏令时,固定偏移安全) */
const CN_DAY_MS = 86_400_000;

/** 台账行读侧投影(findMany select 与聚合入参共用) */
export interface UsageRowLike {
  role: string;
  modelId: number | null;
  modelKey: string;
  tokensIn: number;
  tokensOut: number;
  audioSeconds: number;
  status: string;
  createdAt: Date;
}

/** 牌价表(读时快照):LLM ¥/1M、生图 ¥/张、ASR ¥/h;null=未定价按 0 折算 */
export interface UsagePrices {
  models: Map<
    number,
    { priceIn: number | null; priceOut: number | null; pricePerImage: number | null }
  >;
  asrPricePerHour: number | null;
}

export interface UsageKpi {
  tokens: number;
  prevTokens: number;
  cost: number;
  asrHours: number;
  asrCount: number;
  asrCost: number;
  degradedAsr: number;
  degradedLlm: number;
}

export interface UsageDayBucket {
  date: string;
  tokens: number;
  cost: number;
}

export interface UsageDistRow {
  key: string;
  tokens: number;
  calls: number;
}

export interface UsageDetailRow {
  role: string;
  modelKey: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  lastUsed: Date;
  spark: number[];
}

export interface UsageOverview {
  days: number;
  since: Date;
  kpi: UsageKpi;
  daily: UsageDayBucket[];
  byRole: UsageDistRow[];
  byModel: UsageDistRow[];
  rows: UsageDetailRow[];
}

/** 窗口起点:含今天在内的 days 个 CN 日,起点为最旧一天的 CN 零点(UTC 即刻) */
export function usageWindowSince(now: Date, days: number): Date {
  const oldestCn = formatCnDate(new Date(now.getTime() - (days - 1) * CN_DAY_MS));
  return new Date(Date.parse(`${oldestCn}T00:00:00+08:00`));
}

/** 单行费用(¥;failed 不计费;未定价按 0) */
export function costOfRow(row: UsageRowLike, prices: UsagePrices): number {
  if (row.status === "failed") return 0;
  if (row.role === AI_USAGE_ROLE_ASR) {
    const perHour = prices.asrPricePerHour;
    if (perHour == null) return 0;
    return (row.audioSeconds / 3600) * perHour;
  }
  const p = row.modelId != null ? prices.models.get(row.modelId) : undefined;
  if (!p) return 0;
  if (row.role === COVER_ROLE) return p.pricePerImage ?? 0;
  const pin = p.priceIn ?? 0;
  const pout = p.priceOut ?? 0;
  return (row.tokensIn / 1_000_000) * pin + (row.tokensOut / 1_000_000) * pout;
}

/** 等宽时间桶趋势(明细行 spark):14 桶,计数取 tokens;空桶 0 */
export function sparkTrend(rows: UsageRowLike[], since: Date, until: number): number[] {
  const span = Math.max(1, until - since.getTime());
  const buckets = new Array<number>(SPARK_BUCKETS).fill(0);
  for (const r of rows) {
    const t = r.createdAt.getTime();
    if (t < since.getTime() || t > until) continue;
    const idx = Math.min(
      SPARK_BUCKETS - 1,
      Math.floor(((t - since.getTime()) / span) * SPARK_BUCKETS),
    );
    buckets[idx] += r.tokensIn + r.tokensOut;
  }
  return buckets;
}

/** 纯聚合(单测锚点):行 + 牌价 → 看板全部结构 */
export function aggregateUsage(
  rows: UsageRowLike[],
  prices: UsagePrices,
  opts: { days: number; now: Date; prevTokens: number },
): UsageOverview {
  const { days, now, prevTokens } = opts;
  const since = usageWindowSince(now, days);
  const inWindow = rows.filter((r) => r.createdAt >= since);

  const kpi: UsageKpi = {
    tokens: 0,
    prevTokens,
    cost: 0,
    asrHours: 0,
    asrCount: 0,
    asrCost: 0,
    degradedAsr: 0,
    degradedLlm: 0,
  };
  // CN 日桶(含今天,共 days 个)
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(formatCnDate(new Date(now.getTime() - i * CN_DAY_MS)));
  }
  const dayMap = new Map<string, UsageDayBucket>(
    dayKeys.map((d) => [d, { date: d, tokens: 0, cost: 0 }]),
  );

  const roleAgg = new Map<string, UsageDistRow>();
  const modelAgg = new Map<string, UsageDistRow>();
  const detailAgg = new Map<string, { row: UsageDetailRow; raws: UsageRowLike[] }>();

  for (const r of inWindow) {
    const tokens = r.tokensIn + r.tokensOut;
    const cost = costOfRow(r, prices);
    kpi.tokens += tokens;
    kpi.cost += cost;
    if (r.role === AI_USAGE_ROLE_ASR) {
      if (r.status === "degraded") kpi.degradedAsr += 1;
      if (r.status === "ok") {
        kpi.asrCount += 1;
        kpi.asrHours += r.audioSeconds / 3600;
        kpi.asrCost += cost;
      }
    } else if (r.status === "degraded") {
      kpi.degradedLlm += 1;
    }
    const day = dayMap.get(formatCnDate(r.createdAt));
    if (day) {
      day.tokens += tokens;
      day.cost += cost;
    }
    const bump = (m: Map<string, UsageDistRow>, key: string) => {
      const cur = m.get(key) ?? { key, tokens: 0, calls: 0 };
      cur.tokens += tokens;
      cur.calls += 1;
      m.set(key, cur);
    };
    bump(roleAgg, r.role);
    bump(modelAgg, r.modelKey);
    const dk = `${r.role}|${r.modelKey}`;
    const cur = detailAgg.get(dk) ?? {
      row: {
        role: r.role,
        modelKey: r.modelKey,
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        lastUsed: r.createdAt,
        spark: [],
      },
      raws: [],
    };
    cur.row.calls += 1;
    cur.row.tokensIn += r.tokensIn;
    cur.row.tokensOut += r.tokensOut;
    cur.row.cost += cost;
    if (r.createdAt > cur.row.lastUsed) cur.row.lastUsed = r.createdAt;
    cur.raws.push(r);
    detailAgg.set(dk, cur);
  }

  const detailRows: UsageDetailRow[] = [...detailAgg.values()]
    .map(({ row, raws }) => ({ ...row, spark: sparkTrend(raws, since, now.getTime()) }))
    .sort((a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut) || b.cost - a.cost);
  const byDist = (m: Map<string, UsageDistRow>): UsageDistRow[] =>
    [...m.values()].sort((a, b) => b.tokens - a.tokens || b.calls - a.calls);

  return {
    days,
    since,
    kpi,
    daily: dayKeys.map((d) => dayMap.get(d)!),
    byRole: byDist(roleAgg),
    byModel: byDist(modelAgg),
    rows: detailRows,
  };
}

/** 页面取数主入口(RSC 消费):两查询 + 内存聚合 */
export async function getUsageOverview(days: 7 | 30 | 90): Promise<UsageOverview> {
  const now = new Date();
  const since = usageWindowSince(now, days);
  const prevSince = new Date(since.getTime() - days * CN_DAY_MS);

  const [rows, prev, models, asr] = await Promise.all([
    prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: prevSince } },
      select: {
        role: true,
        modelId: true,
        modelKey: true,
        tokensIn: true,
        tokensOut: true,
        audioSeconds: true,
        status: true,
        createdAt: true,
      },
    }),
    // 环比基线:上一窗口 tokens 合计(单次 aggregate,免全行拉取)
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: prevSince, lt: since } },
      _sum: { tokensIn: true, tokensOut: true },
    }),
    prisma.aiModel.findMany({
      select: { id: true, priceIn: true, priceOut: true, pricePerImage: true },
    }),
    prisma.asrConfig.findUnique({
      select: { pricePerHour: true },
      where: { id: ASR_CONFIG_ID },
    }),
  ]);

  const prices: UsagePrices = {
    models: new Map(
      models.map((m) => [
        m.id,
        { priceIn: m.priceIn, priceOut: m.priceOut, pricePerImage: m.pricePerImage },
      ]),
    ),
    asrPricePerHour: asr?.pricePerHour ?? null,
  };
  return aggregateUsage(rows, prices, {
    days,
    now,
    prevTokens: (prev._sum.tokensIn ?? 0) + (prev._sum.tokensOut ?? 0),
  });
}
