/**
 * M64 榜单快照实体回填:历史 insight_leaderboard_snapshot.entity_key →
 * insight_entity(M64 迁移后存量行 entity_id 为空,新采集自己会写)。
 *
 * @status oneoff(生产执行一次后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/leaderboard-entity-backfill/run.ts           # dry-run(只读)
 *   npx tsx scripts/oneoff/leaderboard-entity-backfill/run.ts --apply   # 实际写库
 *
 * 口径与采集写入完全一致(唯一出口 src/lib/insight/entities/leaderboard.ts):
 * 只处理 Artificial Analysis / Hugging Face 两源、entity_id IS NULL 的行;
 * 只读解析,未命中留空(不建实体、不改别名)。幂等:重跑只碰仍为空的行。
 * 解析率按源输出,便于对照 §16.5 验收(AA ≥ 90%)。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const SOURCES = ["artificial-analysis", "huggingface"] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../../../src/lib/db");
  const { resolveLeaderboardEntities } =
    await import("../../../src/lib/insight/entities/leaderboard");

  const batchArg = process.argv.find((a) => a.startsWith("--batch="));
  const batch = batchArg ? Math.max(1, Math.min(2000, Number(batchArg.slice(8)) || 500)) : 500;

  const stats = new Map<string, { scanned: number; hit: number; miss: number }>();
  let lastId = BigInt(0);

  for (;;) {
    const rows = await prisma.insightLeaderboardSnapshot.findMany({
      where: { source: { in: [...SOURCES] }, entityId: null, id: { gt: lastId } },
      orderBy: { id: "asc" },
      take: batch,
      select: { id: true, source: true, entityKey: true },
    });
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    const bySource = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = bySource.get(row.source);
      if (list === undefined) bySource.set(row.source, [row]);
      else list.push(row);
    }

    for (const [source, sourceRows] of bySource) {
      const resolved = await resolveLeaderboardEntities(
        source,
        sourceRows.map((r) => r.entityKey),
      );
      const idsOf = new Map<bigint, bigint[]>();
      for (const row of sourceRows) {
        const s = stats.get(source) ?? { scanned: 0, hit: 0, miss: 0 };
        s.scanned += 1;
        const ref = resolved.get(row.entityKey) ?? null;
        if (ref === null) {
          s.miss += 1;
          stats.set(source, s);
          continue;
        }
        s.hit += 1;
        stats.set(source, s);
        const ids = idsOf.get(ref.id);
        if (ids === undefined) idsOf.set(ref.id, [row.id]);
        else ids.push(row.id);
      }
      if (!apply) continue;
      for (const [entityId, ids] of idsOf) {
        await prisma.insightLeaderboardSnapshot.updateMany({
          where: { id: { in: ids }, entityId: null },
          data: { entityId },
        });
      }
    }
    console.log(`…已扫 ${[...stats.values()].reduce((n, s) => n + s.scanned, 0)} 行`);
  }

  console.log(apply ? "回填完成:" : "dry-run(未写库,加 --apply 执行):");
  for (const source of SOURCES) {
    const s = stats.get(source) ?? { scanned: 0, hit: 0, miss: 0 };
    const rate = s.scanned === 0 ? "0%" : `${((s.hit / s.scanned) * 100).toFixed(1)}%`;
    console.log(
      `  ${source}: 扫描 ${s.scanned} / 命中 ${s.hit} / 未命中 ${s.miss} · 解析率 ${rate}`,
    );
  }

  const [remaining, linked] = await Promise.all([
    prisma.insightLeaderboardSnapshot.count({
      where: { source: { in: [...SOURCES] }, entityId: null },
    }),
    prisma.insightLeaderboardSnapshot.count({
      where: { source: { in: [...SOURCES] }, entityId: { not: null } },
    }),
  ]);
  console.log(`两源快照:已挂实体 ${linked} 行 / 仍为空 ${remaining} 行`);
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("leaderboard-entity-backfill 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
