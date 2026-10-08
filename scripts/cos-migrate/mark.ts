/**
 * storage 标记切换(M19 批③最后一步):npm run cos:mark -- --yes
 * 前提:cos:verify 对账全绿。URL 不变(media.path 就是公网路径,arch/08 §1 红线),
 * 只把 content_media.storage local→cos 作为事实记录;引用(path/thumbPath/MediaRef)零改动。
 * 运行位置:能连目标库的环境——生产在 175 容器内:
 *   sudo docker compose -f docker-compose.prod.yml exec worker npx tsx scripts/cos-migrate/mark.ts -- --yes
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    throw new Error("预览模式:加 --yes 才实际执行(先确认 cos:verify 全绿)");
  }
  const prisma = new PrismaClient();
  try {
    const before = await prisma.media.groupBy({ by: ["storage"], _count: { _all: true } });
    console.log(
      "切换前 storage 分布:",
      before.map((g) => `${g.storage}=${g._count._all}`).join(", "),
    );
    const r = await prisma.media.updateMany({
      where: { storage: { not: "cos" } },
      data: { storage: "cos" },
    });
    console.log(`已切换 ${r.count} 行 storage=cos(URL/thumbPath/引用零改动)`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error("cos:mark 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
