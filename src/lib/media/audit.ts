/**
 * 媒体体检任务(media.audit,arch/08-media §3.2;每日定时 + 后台手动触发):
 * - 孤儿:存储有、无引用 → status=orphan(重新被引用则回 active);
 * - 断链:库里有行、盘里无文件 → status=missing(恢复则回 active/orphan);
 * - 回收站清退:软删超过 MEDIA_LIMITS.trashDays 天 → 物理删除文件 + 记录。
 * 幂等:全量重算状态,可重复执行;清退先删文件后删记录(失败重跑补删)。
 */
import { prisma } from "@/lib/db";
import { type MediaStatus, DAY_MS, MEDIA_LIMITS } from "@/lib/media/media-schema";
import { loadReferencedPathSet } from "@/lib/media/queries";
import { purgeDeletedMedia } from "@/lib/media/service";
import { mediaStorage, uploadsUrlToRel } from "@/lib/media/storage";

export interface AuditSummary {
  orphaned: number;
  restored: number;
  missing: number;
  purged: number;
}

export async function runAudit(): Promise<AuditSummary> {
  const summary: AuditSummary = { orphaned: 0, restored: 0, missing: 0, purged: 0 };

  // 1) 引用索引(路径即身份;封面算引用;口径与读侧同源——评审 W5)
  const refSet = await loadReferencedPathSet();

  // 2) 逐行重算 active/orphan/missing(软删行不参与)
  const rows = await prisma.media.findMany({
    where: { deletedAt: null, status: { not: "processing" } },
    select: { id: true, path: true, status: true },
  });
  for (const row of rows) {
    const referenced = refSet.has(row.path);
    const onDisk = await mediaStorage.exists(uploadsUrlToRel(row.path) ?? "");
    let next: MediaStatus | null = null;
    if (!onDisk) {
      if (row.status !== "missing") {
        next = "missing";
        summary.missing += 1;
      }
    } else if (referenced) {
      if (row.status !== "active") {
        next = "active";
        summary.restored += 1;
      }
    } else if (row.status !== "orphan") {
      next = "orphan";
      summary.orphaned += 1;
    }
    if (next) {
      await prisma.media.update({ where: { id: row.id }, data: { status: next } });
    }
  }

  // 3) 回收站清退:deletedAt 超期 → 物理删除(文件家族先删、记录后删,失败重跑补删;
  //    引用行随媒体删除本就不存在:软删前置引用检查保证零引用;若之后文章新引用了软删路径,
  //    断链体检会提示)。清退实现在 service.purgeDeletedMedia(与后台「立即清除」单源)
  const expireBefore = new Date(Date.now() - MEDIA_LIMITS.trashDays * DAY_MS);
  const trashed = await prisma.media.findMany({
    where: { deletedAt: { not: null, lt: expireBefore } },
    select: { id: true, path: true },
  });
  summary.purged += await purgeDeletedMedia(trashed);

  return summary;
}
