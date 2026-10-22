/**
 * 写作指南订正(E1 纪律单源化配套,2026-10-21):把 src/lib/ai/writing-guides.ts
 * 现文本全量对账灌入 agent_skill。本轮变更=文生图内容规划标准(CRAFT_ILLUSTRATION_PLAN,
 * 「一图看懂全文,且不虎头蛇尾」细则)单源插值进 blogger-video 与五场景指南;
 * 系统提示/工具描述同步收缩为锚点(不发版改不了的问题就此收口)。实测(2026-10-21
 * 本地 dev 库,回灌自验收库快照)card-rendering 行滞留「卡型路由」旧文本——
 * card-guide-{rich-html,multicard-platform,html-only} 三张 oneoff 均未在此库系
 * 执行(目录未删的假象),本脚本按全 7 技能对账一并收口;生产库预计同样滞留,
 * 部署后执行本脚本即修复。
 *
 * 背景:seed 只在缺行时插入,落库后归后台所有——代码里改指南不会自动生效,
 * 必须显式订正。与代码变更同 PR;部署后执行(指南全文幂等,重复执行跳过)。
 *
 *   npx tsx scripts/oneoff/guide-illustrate-plan/run.ts          # dry-run
 *   npx tsx scripts/oneoff/guide-illustrate-plan/run.ts --apply  # 写库
 *
 * 幂等:文本一致则跳过;执行核验后删除本目录(以 git 历史存档)。
 * @status oneoff
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

import { WRITING_SKILLS } from "../../../src/lib/ai/writing-guides";

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
    let changedCount = 0;
    for (const skill of WRITING_SKILLS) {
      const row = await prisma.agentSkill.findUnique({ where: { key: skill.key } });
      if (!row) {
        console.log(`✗ ${skill.key}:库中无此行(先跑 seed 建行)`);
        continue;
      }
      const changed = row.guideMd !== skill.guideMd;
      console.log(
        `${changed ? "Δ" : "="} ${skill.key}:${row.guideMd.length} → ${skill.guideMd.length} 字符,` +
          `changed=${changed}${changed ? `\n  ${firstDiffLine(row.guideMd, skill.guideMd)}` : ""}`,
      );
      if (changed && apply) {
        await prisma.agentSkill.update({
          where: { key: skill.key },
          data: { guideMd: skill.guideMd },
        });
        console.log(`  ✓ 已写入 ${skill.key}`);
      }
      if (changed) changedCount++;
    }
    console.log(`\n共 ${changedCount} 个技能待更新`);
    if (!apply) console.log("(dry-run;加 --apply 才写库)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
