/**
 * 卡片指南订正:把 src/lib/ai/writing-guides.ts 的现文本灌入 agent_skill
 * (blogger-video + card-rendering 两把 key)。2026-10-20 机制层反转配套——
 * render_card 模板入口在工具面关闭(schema 只留 html),两份指南的「卡型路由
 * (选 preset)」同步改写为「版式语汇」(自由 HTML 的版式设计参考)。
 *
 * 背景:seed 只在缺行时插入,落库后归后台所有——代码里改指南不会自动生效,
 * 必须显式订正。指南文本与工具 schema 变更同 PR,建议部署后执行(旧工具面
 * 会话读到新指南无副作用;新工具面配旧指南仅缺版式语汇参照,均不致错)。
 *
 *   npx tsx scripts/oneoff/card-guide-html-only/run.ts          # dry-run
 *   npx tsx scripts/oneoff/card-guide-html-only/run.ts --apply  # 写库
 *
 * 幂等:文本一致则跳过;执行核验后删除本目录(以 git 历史存档)。
 * @status oneoff
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

import { BLOGGER_VIDEO_GUIDE, CARD_RENDERING_GUIDE } from "../../../src/lib/ai/writing-guides";

const TARGETS = [
  { key: "blogger-video", guideMd: BLOGGER_VIDEO_GUIDE },
  { key: "card-rendering", guideMd: CARD_RENDERING_GUIDE },
] as const;

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
    for (const t of TARGETS) {
      const row = await prisma.agentSkill.findUnique({ where: { key: t.key } });
      if (!row) {
        console.log(`✗ ${t.key}:库中无此行(先跑 seed 建行)`);
        continue;
      }
      const changed = row.guideMd !== t.guideMd;
      console.log(
        `${changed ? "Δ" : "="} ${t.key}:${row.guideMd.length} → ${t.guideMd.length} 字符,` +
          `changed=${changed}${changed ? `\n  ${firstDiffLine(row.guideMd, t.guideMd)}` : ""}`,
      );
      if (changed && apply) {
        await prisma.agentSkill.update({ where: { key: t.key }, data: { guideMd: t.guideMd } });
        console.log(`  ✓ 已写入 ${t.key}`);
      }
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
