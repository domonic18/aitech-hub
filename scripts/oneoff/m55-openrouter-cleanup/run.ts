/**
 * M55 批G(砍除):清理 OpenRouter 预填通道产出行(oneoff,应用后删)。
 * 批B 通道 2026-10-29 用户拍板砍除(非刚需)——其产出行(含测试期误终审的
 * enabled)一并清除,页面回归「官方爬虫+人工」数据面;官方爬虫行
 * (api-docs.deepseek.com / platform.moonshot.cn)与手工行不受影响。
 * 幂等可重跑;运行:npx tsx scripts/oneoff/m55-openrouter-cleanup/run.ts(需 DATABASE_URL)
 */
import { prisma } from "../../../src/lib/db";

async function main(): Promise<void> {
  const del = await prisma.modelPricing.deleteMany({
    where: { sourceUrl: { contains: "openrouter.ai" } },
  });
  console.log(`deleted model_pricing(openrouter 来源):${del.count} 行`);
  const remain = await prisma.modelPricing.count();
  console.log(`remaining model_pricing:${remain} 行`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
