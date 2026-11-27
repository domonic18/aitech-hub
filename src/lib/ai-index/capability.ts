/**
 * AI 智能指数:能力层(Epoch Capabilities Index)
 *
 * ECI 是 Epoch 用 IRT 把各家 benchmark 折算到同一把「能力尺」上的分数,
 * 数值越高代表综合能力越强(不是算力、不是参数量)。
 * 这里用「能力前沿轨迹」——每个刷新历史最高 ECI 的模型记一条。
 */
import { epochEciRecords, epochEciYearly, epochEciMeta } from "./epoch-data";

export const ECI_MAX = epochEciRecords.reduce((m, r) => Math.max(m, r.eci), 0);

/** 能力前沿轨迹(按时间递增的记录点) */
export const eciFrontier = epochEciRecords;

/** 年度汇总 */
export const eciYearly = epochEciYearly;

export const eciMeta = epochEciMeta;

/** 某一天时点的前沿 ECI(取该日之前(含当日)的最后一次刷新记录) */
export function frontierEciAt(date: Date): number | null {
  const target = date.toISOString().slice(0, 10);
  let found: number | null = null;
  for (const r of epochEciRecords) {
    if (r.date <= target) found = r.eci;
    else break;
  }
  return found;
}

/** 能力基线:归一化到 0–100(以历史最高 ECI 为 100) */
export function capabilityBaseAt(date: Date): number | null {
  const eci = frontierEciAt(date);
  if (eci === null || ECI_MAX <= 0) return null;
  return Number(((100 * eci) / ECI_MAX).toFixed(2));
}
