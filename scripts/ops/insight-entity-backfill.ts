/**
 * M60 实体回填:历史 insight_entity_event → 规范实体(insight_entity / insight_entity_alias)。
 * npm run insight:entity-backfill [-- --batch=500]
 * @status ops
 *
 * 幂等:只处理 entity_id IS NULL 的事件,按 occurred_at 升序(先建父级再挂子级),
 * 可重复跑;解析失败的行保留 NULL 待下次重试,不中断整批。
 * 实体口径见 src/lib/insight/entities/resolve.ts:别名 → 匹配键 → 新建(前缀定父)。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const { prisma } = await import("../../src/lib/db");
  const { resolveEntity } = await import("../../src/lib/insight/entities/resolve");

  const batchArg = process.argv.find((a) => a.startsWith("--batch="));
  const batch = batchArg ? Math.max(1, Math.min(2000, Number(batchArg.slice(8)) || 500)) : 500;

  let scanned = 0;
  let linked = 0;
  let failed = 0;
  let lastId = BigInt(0);

  for (;;) {
    const rows = await prisma.insightEntityEvent.findMany({
      where: { entityId: null, id: { gt: lastId } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: batch,
      select: { id: true, vendor: true, entityKey: true, entityType: true },
    });
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned += 1;
      try {
        const entity = await resolveEntity({
          vendorKey: row.vendor,
          rawKey: row.entityKey,
          entityType: row.entityType,
        });
        if (entity === null) {
          failed += 1;
          continue;
        }
        await prisma.insightEntityEvent.update({
          where: { id: row.id },
          data: { entityId: entity.id },
        });
        linked += 1;
      } catch (e) {
        failed += 1;
        console.warn(
          `事件 ${row.id}(${row.entityKey})解析失败:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    console.log(`…已扫 ${scanned}(挂载 ${linked} / 失败 ${failed})`);
  }

  const [entities, aliases, unlinked] = await Promise.all([
    prisma.insightEntity.count({ where: { status: "active" } }),
    prisma.insightEntityAlias.count(),
    prisma.insightEntityEvent.count({ where: { entityId: null } }),
  ]);
  console.log(
    `完成:扫描 ${scanned} 条 → 挂载 ${linked},失败 ${failed};` +
      `实体 ${entities} 个 / 别名 ${aliases} 条 / 仍未挂载 ${unlinked} 条`,
  );
  if (unlinked > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("insight:entity-backfill 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
