/**
 * M74 牌价归一存量回填:model_pricing 存量行 → 厂商字典(provider_id) +
 * 模型字典(model_id)。新采集行自带这两个列(批 B 起),存量行靠本脚本补齐。
 *
 * @status oneoff(生产执行一次后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/m74-pricing-backfill/run.ts           # dry-run(只读)
 *   npx tsx scripts/oneoff/m74-pricing-backfill/run.ts --apply   # 实际写库
 *
 * 口径:
 * - 厂商归一走 `providerKeyForVendor`(采集器写死的 vendor 字符串 → 规范键);
 *   **认不出的不动**(provider_id 留 null)并在报告里点名——猜错厂商比不归一更糟。
 * - 模型归一走 `getOrCreateModel` 唯一出口(model_key / match_key 同一锚复用)。
 * - 幂等:只碰 provider_id / model_id 仍为空的行,重跑不再改已归一的行。
 * - 不改任何价格/状态列;不改 vendor 字符串(展示名沿用原样)。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

interface PricingRow {
  id: bigint;
  vendor: string;
  modelKey: string;
  providerId: bigint | null;
  modelId: bigint | null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../../../src/lib/db");
  const { getOrCreateModel, syncPricingProviders } =
    await import("../../../src/lib/pricing/model-registry");
  const { providerKeyForVendor } = await import("../../../src/lib/pricing/provider-registry");
  const { normalizeModelKey } = await import("../../../src/lib/pricing/normalize");

  const rows: PricingRow[] = await prisma.modelPricing.findMany({
    select: { id: true, vendor: true, modelKey: true, providerId: true, modelId: true },
    orderBy: { id: "asc" },
  });

  const unresolvedVendors = new Map<string, number>();
  const needProvider: PricingRow[] = [];
  const needModel: PricingRow[] = [];
  for (const row of rows) {
    if (row.providerId === null) {
      const key = providerKeyForVendor(row.vendor);
      if (key === null) {
        unresolvedVendors.set(row.vendor, (unresolvedVendors.get(row.vendor) ?? 0) + 1);
      } else {
        needProvider.push(row);
      }
    }
    if (row.modelId === null && normalizeModelKey(row.modelKey) !== "") {
      needModel.push(row);
    }
  }

  console.log(`[预览] model_pricing 存量行 ${rows.length}`);
  console.log(`[预览] 需归一厂商 ${needProvider.length} 行 / 需归一模型 ${needModel.length} 行`);
  if (unresolvedVendors.size > 0) {
    console.log("[预览] 厂商认不出(留 null,需人工裁定):");
    for (const [vendor, n] of unresolvedVendors) console.log(`         ${vendor} × ${n}`);
  }
  const distinctModels = new Set(needModel.map((r) => normalizeModelKey(r.modelKey)));
  console.log(`[预览] 涉及归一后模型键 ${distinctModels.size} 个`);

  if (!apply) {
    console.log("\n[dry-run] 未写库;加 --apply 执行。");
    return;
  }

  const providersCreated = await syncPricingProviders();
  console.log(`\n[执行] 厂商字典新建 ${providersCreated} 行`);

  // 模型字典:逐行 get-or-create(并发下唯一冲突回读),再按 model_id 批量回写
  const modelIdByRow = new Map<string, bigint>();
  for (const row of needModel) {
    const model = await getOrCreateModel({ rawKey: row.modelKey });
    modelIdByRow.set(row.id.toString(), model.id);
  }

  const updated = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const row of needProvider) {
      const key = providerKeyForVendor(row.vendor);
      if (key === null) continue;
      const provider = await tx.modelPricingProvider.findUnique({
        where: { key },
        select: { id: true },
      });
      if (provider === null) continue;
      await tx.modelPricing.update({ where: { id: row.id }, data: { providerId: provider.id } });
      n += 1;
    }
    for (const row of needModel) {
      const modelId = modelIdByRow.get(row.id.toString());
      if (modelId === undefined) continue;
      await tx.modelPricing.update({ where: { id: row.id }, data: { modelId } });
      n += 1;
    }
    return n;
  });

  console.log(`[执行] 回写 ${updated} 个字段(厂商 + 模型)`);
  console.log("[完成] 厂商认不出的行保持 provider_id=null,见上方报告。");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
