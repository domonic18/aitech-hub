/**
 * 站内问句存量清理(M58 批⑤,data-expansion-plan §8.2):internal-agent 切
 * 「页面上下文黑名单」复活前,该源曾混入后台写作会话,按 session 归属一次性
 * 清理——ref_id 指向 search_agent_session 且 visitor_id 以 `admin:` 开头的
 * 信号行。非 admin 会话的存量问句(真实用户)保留。
 *
 * 幂等:按归属判定,重跑对已删行无动作(dry-run 只报数,--apply 才删;
 * cluster 成员行由 onDelete: Cascade 连带清)。
 *
 * @status oneoff(生产执行后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/internal-agent-admin-purge/run.ts            # dry-run
 *   npx tsx scripts/oneoff/internal-agent-admin-purge/run.ts --apply
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const BATCH = 500;

async function main(): Promise<void> {
  const { prisma } = await import("../../../src/lib/db");
  try {
    const adminSessions = await prisma.searchAgentSession.findMany({
      where: { visitorId: { startsWith: "admin:" } },
      select: { id: true },
    });
    const adminIds = adminSessions.map((r) => r.id);

    const targets: bigint[] = [];
    for (let i = 0; i < adminIds.length; i += BATCH) {
      const rows = await prisma.insightSignal.findMany({
        where: { source: "internal-agent", refId: { in: adminIds.slice(i, i + BATCH) } },
        select: { id: true },
      });
      targets.push(...rows.map((r) => r.id));
    }

    const before = await prisma.insightSignal.count({ where: { source: "internal-agent" } });
    console.log(
      `admin 会话 ${adminIds.length} 个;internal-agent 存量 ${before} 条,命中待删 ${targets.length} 条`,
    );

    if (!APPLY) {
      console.log("dry-run:未删(--apply 执行)");
      return;
    }

    let deleted = 0;
    for (let i = 0; i < targets.length; i += BATCH) {
      const r = await prisma.insightSignal.deleteMany({
        where: { id: { in: targets.slice(i, i + BATCH) } },
      });
      deleted += r.count;
    }
    const after = await prisma.insightSignal.count({ where: { source: "internal-agent" } });
    console.log(`已删 ${deleted} 条;剩余 ${after} 条`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
