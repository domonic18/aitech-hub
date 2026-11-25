/**
 * 档位参数 params 存量回填(P3 收尾):把现有 model_pricing_tier 中 params 为空
 * 且非 token 计价的档位,按 tierLabel 解析出 resolution/hasAudio/durationSec/fps。
 *
 * 幂等:已设 params 的行跳过;重复执行结果一致。
 *
 * @status oneoff(生产执行一次后删除本目录,git 历史存档)
 *
 * 用法:
 *   # dry-run(只读,打印将更新的行数):
 *   npx tsx scripts/oneoff/pricing-tier-params-backfill/run.ts
 *
 *   # 写库:
 *   APPLY=1 npx tsx scripts/oneoff/pricing-tier-params-backfill/run.ts
 */
import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";

loadEnvConfig(process.cwd());

import { prisma } from "../../../src/lib/db";
import { parseTierParams } from "../../../src/lib/pricing/params";
import { resolutionOf } from "../../../src/lib/pricing/resolution";
import { isTokenUnit } from "../../../src/lib/pricing/units";

const APPLY = process.env.APPLY === "1";

async function main(): Promise<void> {
  const rows = await prisma.modelPricingTier.findMany({
    where: {
      unit: { notIn: ["per_1m_tokens", "per_1k_tokens"] },
    },
    select: { id: true, tierLabel: true, unit: true, params: true },
    orderBy: { id: "asc" },
  });

  let updated = 0;
  let unchanged = 0;

  for (const r of rows) {
    if (r.params !== null || isTokenUnit(r.unit)) {
      unchanged++;
      continue;
    }
    const parsed = parseTierParams(r.tierLabel, resolutionOf(r.tierLabel));
    const hasAny =
      parsed.resolution !== null ||
      parsed.hasAudio !== null ||
      parsed.durationSec !== null ||
      parsed.fps !== null;
    if (!hasAny) {
      unchanged++;
      continue;
    }
    if (APPLY) {
      await prisma.modelPricingTier.update({
        where: { id: r.id },
        data: { params: parsed as unknown as Prisma.InputJsonValue },
      });
    }
    updated++;
  }

  console.log(
    `tier params backfill: scanned=${rows.length} updated=${updated} unchanged=${unchanged} apply=${APPLY}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
