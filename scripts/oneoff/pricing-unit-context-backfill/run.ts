/**
 * 牌价一次性订正:token 计价单位统一到「元/百万 tokens」+ 上下文长度回填。
 *
 * @status oneoff(生产执行一次后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/pricing-unit-context-backfill/run.ts           # dry-run(只读)
 *   npx tsx scripts/oneoff/pricing-unit-context-backfill/run.ts --apply   # 实际写库
 *
 * 两条订正(口径与线上代码同源,不在脚本里另写一份):
 * - **单位归一**:price_unit=per_1k_tokens 的行,输入/输出价 ×1000、单位改
 *   per_1m_tokens(该行档位同口径同改)。源页按「元/K token」报价,列头/比价区
 *   却写「每百万 tokens」——不归一就是差 1000 倍的错价。
 * - **上下文回填**:context_window 为空、但档位带输入长度阶梯的行,按阶梯上界
 *   补上下文(如 0<Token≤1M → 1M)。源页没直接写上下文字段,阶梯到哪档就是
 *   封顶在哪。
 *
 * 口径:
 * - 幂等:单位已是 per_1m 的行不碰;上下文已填的行不碰;重跑不再改。
 * - 只碰计价单位与上下文两列,不动价格语义之外的东西(状态/定稿/来源不动)。
 * - 线上读侧已做同口径归一与推导(读侧兜底),本脚本只让库里的值也一致。
 */
import { loadEnvConfig } from "@next/env";
import type { Prisma } from "@prisma/client";

loadEnvConfig(process.cwd());

interface PricingRow {
  id: bigint;
  vendor: string;
  modelKey: string;
  inputPrice: Prisma.Decimal | null;
  outputPrice: Prisma.Decimal | null;
  priceUnit: string;
  contextWindow: string | null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../../../src/lib/db");
  const { contextTokensFromTiers, formatContextTokens } =
    await import("../../../src/lib/pricing/context");
  const { normalizedUnit, tokenUnitFactor } = await import("../../../src/lib/pricing/units");

  const rows: PricingRow[] = await prisma.modelPricing.findMany({
    select: {
      id: true,
      vendor: true,
      modelKey: true,
      inputPrice: true,
      outputPrice: true,
      priceUnit: true,
      contextWindow: true,
    },
    orderBy: { id: "asc" },
  });
  const tiers = await prisma.modelPricingTier.findMany({
    select: {
      modelPricingId: true,
      tierLabel: true,
      inputPrice: true,
      outputPrice: true,
      cachePrice: true,
      minTokens: true,
      maxTokens: true,
      unit: true,
    },
  });
  const tiersByRow = new Map<string, typeof tiers>();
  for (const t of tiers) {
    const key = t.modelPricingId.toString();
    const list = tiersByRow.get(key);
    if (list === undefined) tiersByRow.set(key, [t]);
    else list.push(t);
  }

  const unitFixed: PricingRow[] = [];
  const contextFilled: Array<{ row: PricingRow; context: string }> = [];

  for (const row of rows) {
    const rowTiers = tiersByRow.get(row.id.toString()) ?? [];
    if (row.priceUnit === "per_1k_tokens") {
      unitFixed.push(row);
    }
    if (row.contextWindow === null && rowTiers.length > 0) {
      const derived = formatContextTokens(
        contextTokensFromTiers(
          rowTiers.map((t) => ({ minTokens: t.minTokens, maxTokens: t.maxTokens })),
        ),
      );
      if (derived !== null) contextFilled.push({ row, context: derived });
    }
  }

  console.log(`[预览] model_pricing 存量行 ${rows.length}`);
  console.log(`[预览] 单位待归一(per_1k → per_1m,价 ×1000)${unitFixed.length} 行`);
  for (const row of unitFixed) {
    console.log(`        ${row.id} ${row.vendor} ${row.modelKey} ${row.priceUnit}`);
  }
  console.log(`[预览] 上下文待回填(按档位阶梯推导)${contextFilled.length} 行`);
  for (const { row, context } of contextFilled.slice(0, 30)) {
    console.log(`        ${row.id} ${row.vendor} ${row.modelKey} → ${context}`);
  }
  if (contextFilled.length > 30) console.log(`        ……其余 ${contextFilled.length - 30} 行略`);
  if (!apply) {
    console.log("[dry-run] 未写库;加 --apply 实际执行");
    return;
  }

  for (const row of unitFixed) {
    const factor = tokenUnitFactor(row.priceUnit);
    await prisma.modelPricing.update({
      where: { id: row.id },
      data: {
        priceUnit: normalizedUnit(row.priceUnit),
        inputPrice: row.inputPrice === null ? null : row.inputPrice.mul(factor),
        outputPrice: row.outputPrice === null ? null : row.outputPrice.mul(factor),
      },
    });
    const rowTiers = tiersByRow.get(row.id.toString()) ?? [];
    for (const t of rowTiers) {
      await prisma.modelPricingTier.update({
        where: { modelPricingId_tierLabel: { modelPricingId: row.id, tierLabel: t.tierLabel } },
        data: {
          unit: normalizedUnit(t.unit),
          inputPrice: t.inputPrice === null ? null : t.inputPrice.mul(factor),
          outputPrice: t.outputPrice === null ? null : t.outputPrice.mul(factor),
          cachePrice: t.cachePrice === null ? null : t.cachePrice.mul(factor),
        },
      });
    }
  }
  for (const { row, context } of contextFilled) {
    await prisma.modelPricing.update({
      where: { id: row.id },
      data: { contextWindow: context },
    });
  }
  console.log(`[完成] 单位归一 ${unitFixed.length} 行;上下文回填 ${contextFilled.length} 行`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
