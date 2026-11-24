/**
 * 牌价采集源健康度(M74 批C2):各牌价源最近采集结果 + 产出行的状态分布。
 *
 * 为什么要有:采集是异步的(worker 定时跑),**前台看不到采集是否还活着**——
 * 源挂了只表现为「价格不更新」,运营只能翻日志找。这里把「源健康 + 产出分布 +
 * 最近一次采集结果」摆到策展台面上。
 *
 * 口径:
 * - 源与行的对应走 **source-resolve.ts**(M79 系统修):providerKey + 产出面优先,
 *   vendor 精确匹配兜底——聚合源(词元所)一行多 vendor,按 vendor 连不上自己的源,
 *   此前其 pending/recheck 产出全部漏算。不靠 URL(渠道 URL 会被后台改,按 URL 连会错位)
 * - 同一 providerKey 下可能有兄弟源(腾讯云 = Token Plan 套餐 + 混元模型牌价),
 *   故产出面要分:model 源看模型表、plan 源看套餐表
 * - 「待复核」= note 带【待复核】标(采集失败时整源打标),与 pending(待终审)是两回事
 */
import { prisma } from "@/lib/db";

import { buildPricingSourceResolver, type ResolvableSource } from "./source-resolve";
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
  /** 厂商(展示口径;源↔行解析主键是 providerKey,见 source-resolve.ts) */
  vendor: string;
  /** 厂商归一键(与行侧 provider 字典同一空间) */
  providerKey: string;
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

/**
 * 行集 → 各源的状态分布(经 source-resolve 解析归桶)。
 * 连不上任何源的行不计(与旧 vendor 口径对未匹配行的处理一致)。
 */
function countsBySource(
  defs: readonly ResolvableSource[],
  rows: Array<{ vendor: string; status: string; note: string | null; providerKey: string | null }>,
  target: "model" | "plan",
): Map<string, SourceRowCounts> {
  const resolve = buildPricingSourceResolver(defs);
  const map = new Map<string, SourceRowCounts>();
  for (const r of rows) {
    const src = resolve({ vendor: r.vendor, target, providerKey: r.providerKey });
    if (src === undefined) continue;
    const c = map.get(src.key) ?? emptyCounts();
    addStatusCount(c, r.status, 1);
    if (r.note !== null && r.note.includes("【待复核")) c.recheck += 1;
    map.set(src.key, c);
  }
  return map;
}

export async function listPricingSourceHealth(): Promise<PricingSourceHealth[]> {
  const sources = await prisma.crawlSource.findMany({
    where: { type: "pricing" },
    orderBy: { id: "asc" },
  });
  if (sources.length === 0) return [];

  // 行状态分布(带 provider 归一键整表拉回,经解析器归桶;两表各几百行,量级安全)
  const [modelRows, planRows] = await Promise.all([
    prisma.modelPricing.findMany({
      select: {
        vendor: true,
        status: true,
        note: true,
        provider: { select: { key: true } },
      },
    }),
    prisma.codingPlan.findMany({
      select: { vendor: true, status: true, note: true },
    }),
  ]);

  const defLikes: ResolvableSource[] = SOURCE_DEFS.map((d) => ({
    key: d.key,
    vendor: d.vendor,
    target: d.target,
    providerKey: d.providerKey,
  }));
  const modelCounts = countsBySource(
    defLikes,
    modelRows.map((r) => ({
      vendor: r.vendor,
      status: r.status,
      note: r.note,
      providerKey: r.provider?.key ?? null,
    })),
    "model",
  );
  const planCounts = countsBySource(
    defLikes,
    planRows.map((r) => ({
      vendor: r.vendor,
      status: r.status,
      note: r.note,
      providerKey: null,
    })),
    "plan",
  );

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
    // 未注册的源(后台手加)没有产出面定义,按 model 兜底(vendor 同为 key 兜底,
    // providerKey 置空 → 行解析只走 vendor 档)
    const target = def?.target ?? "model";
    const snap = lastBySource.get(s.id);
    return {
      key,
      label: def?.label ?? s.remark ?? s.name,
      vendor,
      providerKey: def?.providerKey ?? "",
      target,
      url: s.url,
      enabled: s.enabled,
      intervalMin: s.crawlIntervalMin,
      status: s.status,
      consecutiveFails: s.consecutiveFails,
      lastRunAt: s.lastRunAt,
      nextRunAt: s.nextRunAt,
      rows: (target === "plan" ? planCounts.get(key) : modelCounts.get(key)) ?? emptyCounts(),
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
