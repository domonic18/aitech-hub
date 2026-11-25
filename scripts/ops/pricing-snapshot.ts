/**
 * 牌价快照基线(P0):导出 /pricing/ 读侧与比价矩阵的稳定 JSON,供改造前后 diff。
 * npm run pricing:snapshot [-- --out=workspace/pricing-baseline/<名>.json]
 * @status ops
 *
 * 内容与前台同源(listPublicPricing + buildCompareGroups),排序稳定可 diff;
 * 不含时间戳(保证两次导出仅数据差异)。默认落 workspace/pricing-baseline/
 * (gitignored,过程性产物不入库)。
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

loadEnvConfig(process.cwd());

interface SnapshotCell {
  provider: string;
  representative: number | null;
}

interface SnapshotModel {
  key: string;
  cheapest: string | null;
  cells: SnapshotCell[];
}

interface SnapshotGroup {
  currency: string;
  unit: string;
  models: SnapshotModel[];
}

async function main(): Promise<void> {
  const { listPublicPricing } = await import("../../src/lib/pricing/read");
  const { buildCompareGroups } = await import("../../src/lib/pricing/compare");

  const data = await listPublicPricing();
  const groups = buildCompareGroups(data.models);

  const models = data.models
    .map((m) => ({
      modelKey: m.modelKey,
      modelDictKey: m.modelDictKey,
      vendor: m.vendor,
      providerKey: m.providerKey,
      modality: m.modality,
      currency: m.currency,
      unit: m.priceUnit,
      input: m.inputPrice,
      output: m.outputPrice,
      tiers: m.tiers.map((t) => t.tierLabel),
    }))
    .sort((a, b) =>
      `${a.modelDictKey ?? ""}|${a.vendor}|${a.modelKey}`.localeCompare(
        `${b.modelDictKey ?? ""}|${b.vendor}|${b.modelKey}`,
      ),
    );

  const snapshotGroups: SnapshotGroup[] = groups
    .map((g) => ({
      currency: g.currency,
      unit: g.priceUnit,
      models: g.models
        .map<SnapshotModel>((m) => ({
          key: m.key,
          cheapest: m.cheapestProviderKey,
          cells: m.cells
            .map<SnapshotCell>((c) => ({
              provider: c.providerKey,
              representative: c.inputPrice ?? c.outputPrice,
            }))
            .sort((a, b) => a.provider.localeCompare(b.provider)),
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    }))
    .sort((a, b) => `${a.currency}|${a.unit}`.localeCompare(`${b.currency}|${b.unit}`));

  const out = {
    modelsCount: models.length,
    groupsCount: snapshotGroups.length,
    modelsAsOf: data.modelsAsOf,
    models,
    groups: snapshotGroups,
  };

  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const target = resolve(outArg ? outArg.slice(6) : "workspace/pricing-baseline/snapshot.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`快照已写 ${target}:模型行 ${models.length},比价组 ${snapshotGroups.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
