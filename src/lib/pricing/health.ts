/**
 * 牌价采集源健康度(M74 批C2):各牌价源最近采集结果 + 产出行的状态分布。
 *
 * 为什么要有:采集是异步的(worker 定时跑),**前台看不到采集是否还活着**——
 * 源挂了只表现为「价格不更新」,运营只能翻日志找。这里把「源健康 + 产出分布 +
 * 最近一次采集结果」摆到策展台面上。
 *
 * 口径:
 * - 源与行的对应靠 **vendor**(采集器写死的稳定标识),不靠 URL——渠道 URL 会被
 *   后台改(历史默认 URL 迁移过),按 URL 连会错位
 * - 「待复核」= note 带【待复核】标(采集失败时整源打标),与 pending(待终审)是两回事
 */
import { prisma } from "@/lib/db";

import { SOURCE_DEFS } from "./source-registry";

/** 一个源的产出状态分布 */
export interface SourceRowCounts {
  total: number;
  /** 待终审(采集落 pending) */
  pending: number;
  /** 已上架 */
  enabled: number;
  /** 已停用 */
  disabled: number;
  /** 带「待复核」标(该源最近一次采集失败) */
  recheck: number;
}

/** 最近一次采集快照结论 */
export interface SourceLastCapture {
  at: Date;
  parseStatus: string;
  rowCount: number | null;
  error: string | null;
}

/** 一个牌价采集源的健康度 */
export interface PricingSourceHealth {
  /** 渠道 key(去掉 `pricing:` 前缀) */
  key: string;
  /** 渠道标签(注册表) */
  label: string;
  /** 厂商(行侧 vendor 口径,行与源靠它对应) */
  vendor: string;
  url: string;
  enabled: boolean;
  /** 采集周期(分钟) */
  intervalMin: number;
  /** healthy / degraded / error */
  status: string;
  consecutiveFails: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  rows: SourceRowCounts;
  lastCapture: SourceLastCapture | null;
}

/** 空分布 */
function emptyCounts(): SourceRowCounts {
  return { total: 0, pending: 0, enabled: 0, disabled: 0, recheck: 0 };
}

export async function listPricingSourceHealth(): Promise<PricingSourceHealth[]> {
  const sources = await prisma.crawlSource.findMany({
    where: { type: "pricing" },
    orderBy: { id: "asc" },
  });
  if (sources.length === 0) return [];

  // 行状态分布(按 vendor 汇总)
  const byStatus = await prisma.modelPricing.groupBy({
    by: ["vendor", "status"],
    _count: { _all: true },
  });
  const recheckRows = await prisma.modelPricing.groupBy({
    by: ["vendor"],
    where: { note: { contains: "【待复核" } },
    _count: { _all: true },
  });

  const countsByVendor = new Map<string, SourceRowCounts>();
  for (const s of byStatus) {
    const c = countsByVendor.get(s.vendor) ?? emptyCounts();
    const n = s._count._all;
    c.total += n;
    if (s.status === "pending") c.pending += n;
    else if (s.status === "enabled") c.enabled += n;
    else if (s.status === "disabled") c.disabled += n;
    countsByVendor.set(s.vendor, c);
  }
  for (const r of recheckRows) {
    const c = countsByVendor.get(r.vendor);
    if (c !== undefined) c.recheck = r._count._all;
  }

  // 每个源最近一次采集快照
  const snapshots = await prisma.crawlSnapshot.findMany({
    where: { sourceId: { in: sources.map((s) => s.id) } },
    orderBy: { capturedAt: "desc" },
    take: 100,
    select: { sourceId: true, capturedAt: true, parseStatus: true, rowCount: true, error: true },
  });
  const lastBySource = new Map<number, (typeof snapshots)[number]>();
  for (const snap of snapshots) {
    if (!lastBySource.has(snap.sourceId)) lastBySource.set(snap.sourceId, snap);
  }

  return sources.map((s) => {
    const key = s.name.startsWith("pricing:") ? s.name.slice("pricing:".length) : s.name;
    const def = SOURCE_DEFS.find((d) => d.key === key);
    const vendor = def?.vendor ?? key;
    const snap = lastBySource.get(s.id);
    return {
      key,
      label: def?.label ?? s.remark ?? s.name,
      vendor,
      url: s.url,
      enabled: s.enabled,
      intervalMin: s.crawlIntervalMin,
      status: s.status,
      consecutiveFails: s.consecutiveFails,
      lastRunAt: s.lastRunAt,
      nextRunAt: s.nextRunAt,
      rows: countsByVendor.get(vendor) ?? emptyCounts(),
      lastCapture:
        snap === undefined
          ? null
          : {
              at: snap.capturedAt,
              parseStatus: snap.parseStatus,
              rowCount: snap.rowCount,
              error: snap.error,
            },
    };
  });
}
