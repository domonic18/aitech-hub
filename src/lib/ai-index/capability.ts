/**
 * AI 智能指数:能力层(Epoch Capabilities Index)
 *
 * ECI 是 Epoch 用 IRT 把各家 benchmark 折算到同一把「能力尺」上的分数,
 * 数值越高代表综合能力越强(不是算力、不是参数量)。
 * 这里用「能力前沿轨迹」——每个刷新历史最高 ECI 的模型记一条。
 *
 * 真相源是 ai_index_eci_model 表(worker 每日从上游包同步),不是编译进镜像的
 * 源码快照——快照只在冷启动播种时兜一次底。
 */
import { prisma } from "@/lib/db";
import { prerenderSafe } from "@/lib/prerender-safe";

export interface EciFrontierPoint {
  date: string; // YYYY-MM-DD
  eci: number;
  model: string;
  organization: string;
}

interface EciModelLite {
  eci: number;
  eciDate: Date;
  displayName: string;
  organization: string;
}

async function listEciModels(): Promise<EciModelLite[]> {
  return prerenderSafe("ai_index.eci_models", [], async () =>
    prisma.aiIndexEciModel.findMany({
      select: { eci: true, eciDate: true, displayName: true, organization: true },
      orderBy: [{ eciDate: "asc" }, { eci: "desc" }],
    }),
  );
}

/** 历史最高 ECI(归一化基准) */
export async function getEciMax(): Promise<number> {
  const rows = await listEciModels();
  return rows.reduce((m, r) => Math.max(m, r.eci), 0);
}

/** 能力前沿轨迹(按时间递增的记录点) */
export async function getEciFrontier(): Promise<EciFrontierPoint[]> {
  const rows = await listEciModels();
  const out: EciFrontierPoint[] = [];
  let max = -Infinity;
  for (const r of rows) {
    if (r.eci > max) {
      max = r.eci;
      out.push({
        date: r.eciDate.toISOString().slice(0, 10),
        eci: r.eci,
        model: r.displayName,
        organization: r.organization,
      });
    }
  }
  return out;
}

/** 某一天时点的前沿 ECI(取该日之前(含当日)的最后一次刷新记录) */
export async function frontierEciAt(date: Date): Promise<number | null> {
  const target = date.toISOString().slice(0, 10);
  const rows = await listEciModels();
  let found: number | null = null;
  for (const r of rows) {
    if (r.eciDate.toISOString().slice(0, 10) > target) break;
    if (found === null || r.eci > found) found = r.eci;
  }
  return found;
}

/** 能力基线:归一化到 0–100(以历史最高 ECI 为 100) */
export async function capabilityBaseAt(date: Date): Promise<number | null> {
  const rows = await listEciModels();
  if (rows.length === 0) return null;
  const target = date.toISOString().slice(0, 10);
  let frontier: number | null = null;
  let max = 0;
  for (const r of rows) {
    if (r.eci > max) max = r.eci;
    if (r.eciDate.toISOString().slice(0, 10) <= target && (frontier === null || r.eci > frontier)) {
      frontier = r.eci;
    }
  }
  if (frontier === null || max <= 0) return null;
  return Number(((100 * frontier) / max).toFixed(2));
}

/**
 * 批量取多日能力基线(逐日重算时只查一次库)。
 * days 用 YYYY-MM-DD;没有对应前沿的日期给 null。
 */
export async function capabilityBaseForDays(days: string[]): Promise<Map<string, number | null>> {
  const rows = await listEciModels();
  const out = new Map<string, number | null>();
  if (rows.length === 0) {
    for (const d of days) out.set(d, null);
    return out;
  }
  const max = rows.reduce((m, r) => Math.max(m, r.eci), 0);
  // 前沿轨迹:按日期推进的 running max
  const frontier: { date: string; eci: number }[] = [];
  let running = -Infinity;
  for (const r of rows) {
    if (r.eci > running) {
      running = r.eci;
      frontier.push({ date: r.eciDate.toISOString().slice(0, 10), eci: r.eci });
    }
  }
  for (const d of days) {
    let value: number | null = null;
    for (const f of frontier) {
      if (f.date <= d) value = f.eci;
      else break;
    }
    out.set(d, value === null || max <= 0 ? null : Number(((100 * value) / max).toFixed(2)));
  }
  return out;
}
