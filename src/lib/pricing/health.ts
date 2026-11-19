/**
 * 牌价采集源健康度(M74 批C2):各牌价源最近采集结果 + 产出行的状态分布。
 *
 * 为什么要有:采集是异步的(worker 定时跑),**前台看不到采集是否还活着**——
 * 源挂了只表现为「价格不更新」,运营只能翻日志找。这里把「源健康 + 产出分布 +
 * 最近一次采集结果」摆到策展台面上。
 *
 * 口径:
 * - 源与行的对应靠 **vendor + 产出面**(采集器写死的稳定标识 + model/plan 表),
 *   不靠 URL——渠道 URL 会被后台改(历史默认 URL 迁移过),按 URL 连会错位
 * - 同一 vendor 下可能有多个源(腾讯云 = Token Plan 套餐 + 混元模型牌价),
 *   故产出面要分:model 源看模型表、plan 源看套餐表。只按 vendor 会把兄弟源
 *   的行算成自己的(套餐源曾把同厂商的模型行数误报成自己的产出)
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
  /** 产出面:model=模型牌价表 / plan=套餐表(同 vendor 下靠它区分兄弟源) */
  target: "model" | "plan";
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

/** 累加一个状态桶的条数 */
function addStatusCount(c: SourceRowCounts, status: string, n: number): void {
  c.total += n;
  if (status === "pending") c.pending += n;
  else if (status === "enabled") c.enabled += n;
  else if (status === "disabled") c.disabled += n;
}

/** 按 vendor 汇总某张表的行状态分布 */
function countsByVendor(
  rows: Array<{ vendor: string; status: string; _count: { _all: number } }>,
): Map<string, SourceRowCounts> {
  const map = new Map<string, SourceRowCounts>();
  for (const r of rows) {
    const c = map.get(r.vendor) ?? emptyCounts();
    addStatusCount(c, r.status, r._count._all);
    map.set(r.vendor, c);
  }
  return map;
}

export async function listPricingSourceHealth(): Promise<PricingSourceHealth[]> {
  const sources = await prisma.crawlSource.findMany({
    where: { type: "pricing" },
    orderBy: { id: "asc" },
  });
  if (sources.length === 0) return [];

  // 行状态分布(模型表与套餐表分开按 vendor 汇总;源按产出面取对应那张表)
  const [modelByStatus, planByStatus, modelRecheck, planRecheck] = await Promise.all([
    prisma.modelPricing.groupBy({
      by: ["vendor", "status"],
      _count: { _all: true },
    }),
    prisma.codingPlan.groupBy({
      by: ["vendor", "status"],
      _count: { _all: true },
    }),
    prisma.modelPricing.groupBy({
      by: ["vendor"],
      where: { note: { contains: "【待复核" } },
      _count: { _all: true },
    }),
    prisma.codingPlan.groupBy({
      by: ["vendor"],
      where: { note: { contains: "【待复核" } },
      _count: { _all: true },
    }),
  ]);

  const modelCounts = countsByVendor(modelByStatus);
  const planCounts = countsByVendor(planByStatus);
  for (const r of modelRecheck) {
    const c = modelCounts.get(r.vendor);
    if (c !== undefined) c.recheck = r._count._all;
  }
  for (const r of planRecheck) {
    const c = planCounts.get(r.vendor);
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
    // 未注册的源(后台手加)没有产出面定义,按 model 兜底(vendor 同为 key 兜底)
    const target = def?.target ?? "model";
    const snap = lastBySource.get(s.id);
    return {
      key,
      label: def?.label ?? s.remark ?? s.name,
      vendor,
      target,
      url: s.url,
      enabled: s.enabled,
      intervalMin: s.crawlIntervalMin,
      status: s.status,
      consecutiveFails: s.consecutiveFails,
      lastRunAt: s.lastRunAt,
      nextRunAt: s.nextRunAt,
      rows: (target === "plan" ? planCounts.get(vendor) : modelCounts.get(vendor)) ?? emptyCounts(),
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
