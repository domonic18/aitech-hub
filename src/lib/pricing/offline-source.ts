/**
 * 牌价按源批量下架(M76):采集源抓取失败时,把该源名下**已上架**的行撤下前台。
 *
 * 行↔源口径与健康读侧(pricing/health.ts)同源,走 **source-resolve**:
 * providerKey + 产出面优先,vendor 精确匹配兜底——
 * - providerKey 是 M74 归一层的稳定键,聚合源(词元所)一行多 vendor 也连得上;
 * - 产出面把同 providerKey 下的兄弟源分开(腾讯云=Token Plan 套餐 + 混元模型牌价);
 * - 套餐表无 provider 列,plan 面仍按 vendor 逐字相等匹配。
 *
 * 只下架**已上架**的行:待终审(pending)还没对外,不动;人工定稿(is_pinned)是
 * 人工确认过的价,源挂不等于价错,不动(与逐条下架 bulkReviewModelPricing 同一
 * 口径);已下架的行跳过(幂等)。
 *
 * 动作面刻意最小:只下架,不上架——重新上架走逐条 review_model_pricing。
 */
import { prisma } from "@/lib/db";

import { revalidatePublicPricing } from "./admin-cache";

/** 一次下架动作涉及的行的记述 */
export interface PricingOfflineEntry {
  table: "model" | "plan";
  id: string;
  name: string;
  status: string;
  pinned: boolean;
  reason: string;
}

/** 按源下架的结果:改了哪些、没改哪些(带原因)、实际改动行数 */
export interface PricingOfflineResult {
  changed: PricingOfflineEntry[];
  skipped: PricingOfflineEntry[];
  /** 实际改动的行数(updateMany 返回;与 changed 长度不等 = 期间有并发改动) */
  applied: number;
}

/** 一张表上圈定待下架的行(已上架 + 非人工定稿) */
async function collectTargets<T extends { id: bigint; status: string; isPinned: boolean }>(
  rows: T[],
  table: "model" | "plan",
  nameOf: (row: T) => string,
): Promise<{ changed: PricingOfflineEntry[]; skipped: PricingOfflineEntry[]; ids: bigint[] }> {
  const changed: PricingOfflineEntry[] = [];
  const skipped: PricingOfflineEntry[] = [];
  const ids: bigint[] = [];
  for (const r of rows) {
    const entry: PricingOfflineEntry = {
      table,
      id: r.id.toString(),
      name: nameOf(r),
      status: r.status,
      pinned: r.isPinned,
      reason: "",
    };
    if (r.status === "enabled" && !r.isPinned) {
      ids.push(r.id);
      entry.reason = "已上架且采集源抓取失败,止损下架";
      changed.push(entry);
    } else {
      entry.reason = r.isPinned
        ? "人工定稿行,采集不覆盖,不下架"
        : r.status === "pending"
          ? "待终审,未上架"
          : "已下架";
      skipped.push(entry);
    }
  }
  return { changed, skipped, ids };
}

/** 按源下架的圈行范围(由调用方从源注册表/健康读侧解析) */
export interface PricingOfflineScope {
  vendor: string;
  target: "model" | "plan";
  /** 厂商归一键:模型表按 provider 连行(聚合源一行多 vendor 的主键);空串走 vendor */
  providerKey: string;
}

/**
 * 按源批量下架(止损):圈定该源名下已上架的行,置 disabled。
 * 幂等:已下架的行跳过,重复调用不再改库。
 */
export async function offlinePricingSource(
  scope: PricingOfflineScope,
): Promise<PricingOfflineResult> {
  if (scope.target === "model") {
    // 模型表:providerKey 命中归一行;未归一(provider_id 空)的行按 vendor 兜底
    const where =
      scope.providerKey !== ""
        ? {
            OR: [
              { provider: { key: scope.providerKey } },
              { providerId: null, vendor: scope.vendor },
            ],
          }
        : { vendor: scope.vendor };
    const rows = await prisma.modelPricing.findMany({
      where,
      select: { id: true, modelKey: true, status: true, isPinned: true },
    });
    const { changed, skipped, ids } = await collectTargets(rows, "model", (r) => r.modelKey);
    const applied =
      ids.length > 0
        ? (
            await prisma.modelPricing.updateMany({
              // 复检 status + isPinned:挑出与写库之间可能有人工改动
              where: { id: { in: ids }, status: "enabled", isPinned: false },
              data: { status: "disabled" },
            })
          ).count
        : 0;
    if (applied > 0) revalidatePublicPricing();
    return { changed, skipped, applied };
  }

  const rows = await prisma.codingPlan.findMany({
    where: { vendor: scope.vendor },
    select: { id: true, planName: true, status: true, isPinned: true },
  });
  const { changed, skipped, ids } = await collectTargets(rows, "plan", (r) => r.planName);
  const applied =
    ids.length > 0
      ? (
          await prisma.codingPlan.updateMany({
            where: { id: { in: ids }, status: "enabled", isPinned: false },
            data: { status: "disabled" },
          })
        ).count
      : 0;
  if (applied > 0) revalidatePublicPricing();
  return { changed, skipped, applied };
}
