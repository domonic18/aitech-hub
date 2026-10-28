/**
 * M54 存量领域回填(oneoff,应用后删;@status 2026-10-28 已应用 dev+本地栈)。
 * 三步:①在役源存量信号全量重置 unclassified(含 subdomain 清空)
 *      ②循环跑分类 sweep(Jev 双问)至清零(上限 20 轮)
 *      ③活跃簇按成员信号 domain 多数重划(历史混池簇重归位)
 * 幂等可重跑;真实调 Jev(存量 ~4.5k 信号 ≈ 4.5k 次输入计费决策,成本可忽略)。
 * 运行:npx tsx scripts/oneoff/m54-domain-backfill/run.ts(需 DATABASE_URL)
 */
import { prisma } from "../../../src/lib/db";
import { runInsightClassify } from "../../../src/lib/insight/classify";
import { INSIGHT_SOURCES_ENABLED } from "../../../src/lib/insight/ingest";

async function main(): Promise<void> {
  const enabled = [...INSIGHT_SOURCES_ENABLED];
  const reset = await prisma.insightSignal.updateMany({
    where: { source: { in: enabled } },
    data: { domain: "unclassified", subdomain: null },
  });
  console.log(`step1 重置 unclassified:${reset.count} 条`);

  let classified = 0;
  let kept = 0;
  let failed = 0;
  for (let round = 1; round <= 20; round += 1) {
    const r = await runInsightClassify(500);
    classified += r.classified;
    kept += r.kept;
    failed += r.failed;
    console.log(
      `round ${round}: scanned=${r.scanned} classified=${r.classified} kept=${r.kept} failed=${r.failed}`,
    );
    if (r.scanned === 0) break;
  }
  console.log(`step2 分类完成:classified=${classified} kept=${kept} failed=${failed}`);

  const clusters = await prisma.insightCluster.findMany({
    where: { status: "active" },
    select: { id: true, domain: true },
  });
  let rebucketed = 0;
  for (const c of clusters) {
    const rows = await prisma.$queryRaw<{ domain: string; cnt: bigint }[]>`
      SELECT s.domain, count(*) AS cnt
        FROM insight_cluster_member m
        JOIN insight_signal s ON s.id = m.signal_id
       WHERE m.cluster_id = ${c.id}
       GROUP BY s.domain
       ORDER BY cnt DESC
       LIMIT 1`;
    const top = rows[0];
    if (top && top.domain !== c.domain) {
      await prisma.insightCluster.update({
        where: { id: c.id },
        data: { domain: top.domain },
        select: { id: true },
      });
      rebucketed += 1;
    }
  }
  console.log(`step3 簇重划:${rebucketed}/${clusters.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
