/**
 * M55 批E:agent_skill「model-pricing」指南补同步口径(oneoff,应用后删)。
 * skill 落库后归后台所有(seed 只补缺不改值),指南文本改动按惯例走 oneoff
 * 订正(blogger-guide-m38 先例);真相源=src/lib/ai/writing-guides.ts。
 * 运行:npx tsx scripts/oneoff/m55-pricing-guide/run.ts(需 DATABASE_URL)
 */
import { prisma } from "../../../src/lib/db";
import { WRITING_SKILLS } from "../../../src/lib/ai/writing-guides";

async function main(): Promise<void> {
  const skill = WRITING_SKILLS.find((s) => s.key === "model-pricing");
  if (!skill) throw new Error("model-pricing 不在 WRITING_SKILLS 注册表");
  const row = await prisma.agentSkill.update({
    where: { key: skill.key },
    data: { guideMd: skill.guideMd },
    select: { id: true, key: true, updatedAt: true },
  });
  console.log(
    `updated agent_skill ${row.key} (id=${row.id}) guideMd=${[...skill.guideMd].length} 码点 at ${row.updatedAt.toISOString()}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
