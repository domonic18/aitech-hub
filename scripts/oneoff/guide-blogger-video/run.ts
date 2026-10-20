/**
 * 写作指南订正:把 src/lib/ai/writing-guides.ts 的 BLOGGER_VIDEO_GUIDE 现文本
 * 灌入 agent_skill(blogger-video)。2026-10-20 详情页重构配套——上一轮
 * guide-channel-neutral(渠道中性化)与本轮「写作要求优先」条款一并落库;
 * 验收库已应用过渠道中性化版,本次为其增量(新增条款 + docblock)。
 *
 * 背景:seed 只在缺行时插入,落库后归后台所有——代码里改指南不会自动生效,
 * 必须显式订正。与代码变更同 PR;部署后执行(旧正文不致错:新条款只约束
 * 下一次生成;指南全文同步幂等,重复执行跳过)。
 *
 *   npx tsx scripts/oneoff/guide-blogger-video/run.ts          # dry-run
 *   npx tsx scripts/oneoff/guide-blogger-video/run.ts --apply  # 写库
 *
 * 幂等:文本一致则跳过;执行核验后删除本目录(以 git 历史存档)。
 * @status oneoff
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

import { BLOGGER_VIDEO_GUIDE } from "../../../src/lib/ai/writing-guides";

const KEY = "blogger-video";

/** 首个差异行(1 起),便于人工核对改了什么 */
function firstDiffLine(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return `第 ${i + 1} 行\n  旧: ${(la[i] ?? "(无)").slice(0, 100)}\n  新: ${(lb[i] ?? "(无)").slice(0, 100)}`;
    }
  }
  return "(无差异)";
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const row = await prisma.agentSkill.findUnique({ where: { key: KEY } });
    if (!row) {
      console.log(`✗ ${KEY}:库中无此行(先跑 seed 建行)`);
      return;
    }
    const changed = row.guideMd !== BLOGGER_VIDEO_GUIDE;
    console.log(
      `${changed ? "Δ" : "="} ${KEY}:${row.guideMd.length} → ${BLOGGER_VIDEO_GUIDE.length} 字符,` +
        `changed=${changed}${changed ? `\n  ${firstDiffLine(row.guideMd, BLOGGER_VIDEO_GUIDE)}` : ""}`,
    );
    if (changed && apply) {
      await prisma.agentSkill.update({
        where: { key: KEY },
        data: { guideMd: BLOGGER_VIDEO_GUIDE },
      });
      console.log(`  ✓ 已写入 ${KEY}`);
    }
    if (!apply) console.log("\n(dry-run;加 --apply 才写库)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
