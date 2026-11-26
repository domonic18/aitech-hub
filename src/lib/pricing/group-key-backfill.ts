/**
 * group_key 存量回填(牌价改造 P1):worker 启动幂等补缺(同 syncPricingProviders
 * 的种子口径)——只给 group_key IS NULL 的字典行按 canon 重算补值,不动已有值
 * (人工裁定优先)。跨行算出同一归一键 = 冲突,保留首行(id 最小)补、其余
 * 留空并 warn 出清单人工裁定,绝不静默合并。
 *
 * 别名表(model-aliases.ts)是源作用域的,回填拿不到 providerKey → 命中任何
 * 别名规则的键跳过,留待该源下轮采集自愈(采集路径带 providerKey)。
 */
import { isP2002, prisma } from "@/lib/db";
import { logInfo, logWarn } from "@/lib/logger";

import { groupOf } from "./canon";
import { MODEL_ALIASES } from "./model-aliases";

export interface GroupKeyBackfillSummary {
  scanned: number;
  filled: number;
  skippedAlias: number;
  conflicts: Array<{ modelKey: string; groupKey: string; heldBy: string }>;
}

const ALIAS_RAW_KEYS = new Set(MODEL_ALIASES.map((r) => r.rawKey));

export async function backfillModelGroupKeys(): Promise<GroupKeyBackfillSummary> {
  const rows = await prisma.modelPricingModel.findMany({
    where: { groupKey: null },
    orderBy: { id: "asc" },
    select: { id: true, modelKey: true, modality: true },
  });
  const summary: GroupKeyBackfillSummary = {
    scanned: rows.length,
    filled: 0,
    skippedAlias: 0,
    conflicts: [],
  };
  if (rows.length === 0) return summary;

  // 先整批计算:批内同组取 id 最小者为正主,其余记冲突;别名键跳过
  const claimByGroup = new Map<string, { id: bigint; modelKey: string }>();
  for (const row of rows) {
    if (ALIAS_RAW_KEYS.has(row.modelKey.trim())) {
      summary.skippedAlias += 1;
      continue;
    }
    const { groupKey } = groupOf(row.modelKey, row.modality);
    if (groupKey === "") continue;
    const holder = claimByGroup.get(groupKey);
    if (holder !== undefined) {
      summary.conflicts.push({ modelKey: row.modelKey, groupKey, heldBy: holder.modelKey });
      continue;
    }
    claimByGroup.set(groupKey, { id: row.id, modelKey: row.modelKey });
  }

  // 库内已持有该组的行(上一轮补过的正主):本批里的重复键 → 冲突清单,
  // 留空待该源下轮采集经 group_key 查找自然归并(pricing 行 model_id 重指正主)
  const existingHolders = await prisma.modelPricingModel.findMany({
    where: { groupKey: { in: [...claimByGroup.keys()] } },
    select: { id: true, groupKey: true, modelKey: true },
  });
  const heldInDb = new Map(existingHolders.map((h) => [h.groupKey as string, h]));

  const fills: Array<{ id: bigint; groupKey: string }> = [];
  for (const [groupKey, claim] of claimByGroup) {
    const holder = heldInDb.get(groupKey);
    if (holder !== undefined && holder.id !== claim.id) {
      summary.conflicts.push({ modelKey: claim.modelKey, groupKey, heldBy: holder.modelKey });
      continue;
    }
    fills.push({ id: claim.id, groupKey });
  }

  for (const f of fills) {
    try {
      const res = await prisma.modelPricingModel.updateMany({
        where: { id: f.id, groupKey: null },
        data: { groupKey: f.groupKey },
      });
      if (res.count > 0) {
        summary.filled += 1;
      }
    } catch (e) {
      // 撞唯一键(并发):留空记冲突,不静默并
      if (!isP2002(e)) throw e;
      summary.conflicts.push({
        modelKey: String(f.id),
        groupKey: f.groupKey,
        heldBy: "(并发写入)",
      });
    }
  }

  if (summary.conflicts.length > 0) {
    logWarn("pricing.group_key_conflicts", {
      count: summary.conflicts.length,
      items: summary.conflicts.slice(0, 20),
    });
  }
  logInfo("pricing.group_key_backfill", {
    scanned: summary.scanned,
    filled: summary.filled,
    skippedAlias: summary.skippedAlias,
    conflicts: summary.conflicts.length,
  });
  return summary;
}
