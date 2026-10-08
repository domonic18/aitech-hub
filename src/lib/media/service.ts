/**
 * 媒体写侧 service(M5-b;arch/08-media §3.4 + arch/05-services §4.2):
 * 上传入库(sha1 去重 → 本地卷 → enqueue sharp 管线)、删除(引用检查 + 软删回收站)、
 * 批量删除(孤儿处置)、回收站恢复/立即清除/清退(2026-10-08 回收站视图)。
 * 读侧(列表/详情/统计/断链)见同目录 queries.ts。
 * 副作用编排(enqueue)与 revalidate 同款纪律:写库成功后再投递,任务幂等可重放。
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { loadReferencedPathSet } from "@/lib/media/queries";
import {
  IMAGE_MIME_WHITELIST,
  MEDIA_LIMITS,
  extByMime,
  type BatchDeleteResult,
  type DupeMergeResult,
  type MediaPurgeResult,
  type MediaRestoreResult,
  type MediaStatus,
} from "@/lib/media/media-schema";
import { getQueue, QUEUE_MEDIA_PROCESS } from "@/lib/queue";
import {
  mediaStorage,
  mediaStorageKind,
  relToUploadsUrl,
  uploadsUrlToRel,
} from "@/lib/media/storage";

/** 业务错误 → Handler 按码映射 HTTP 状态,不裸抛 */
export type MediaErrorCode = "not_found" | "referenced" | "invalid" | "too_large" | "unsupported";

export class MediaError extends Error {
  constructor(
    public code: MediaErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 路径/字符串 id → BigInt;非法返回 null(调用方决定 400/404) */
export function parseMediaId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** sharp 管线投递(jobId 以 sha1 幂等,重复投递直接去重,arch/05 §4.1) */
export function enqueueMediaProcess(mediaId: bigint, sha1: string): Promise<unknown> {
  return getQueue(QUEUE_MEDIA_PROCESS).add(
    "process",
    { mediaId: mediaId.toString() },
    { jobId: `media-${sha1}-process`, attempts: 3, backoff: { type: "exponential", delay: 5_000 } },
  );
}

export interface UploadResult {
  id: string;
  path: string;
  reused: boolean;
  status: string;
}

/**
 * 图片上传入库(arch/08-media §3.4):白名单校验 → sha1 命名 → 本地卷 →
 * DB(status=processing)→ enqueue media.process(worker 出 WebP 副本 + 缩略图 + 宽高回填)。
 * 同 sha1 未软删即复用已有记录(一键发文「sha1 去重命中,复用已有」);
 * 命中回收站软删行则复活原行(路径全站唯一,不允许二次建行)。
 */
export async function uploadMedia(input: {
  data: Uint8Array;
  mime: string;
  filename: string;
}): Promise<UploadResult> {
  if (!(IMAGE_MIME_WHITELIST as readonly string[]).includes(input.mime)) {
    throw new MediaError("unsupported", `不支持的类型 ${input.mime},仅支持 jpg/png/webp/gif`);
  }
  if (input.data.byteLength > MEDIA_LIMITS.maxUploadBytes) {
    throw new MediaError(
      "too_large",
      `单文件不超过 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB`,
    );
  }
  const ext = extByMime(input.mime);
  if (!ext) throw new MediaError("unsupported", `不支持的类型 ${input.mime}`);

  const sha1 = createHash("sha1").update(input.data).digest("hex");
  const dup = await prisma.media.findFirst({
    where: { sha1 },
    select: { id: true, path: true, status: true, deletedAt: true },
  });
  if (dup && dup.deletedAt === null) {
    return { id: dup.id.toString(), path: dup.path, reused: true, status: dup.status };
  }
  if (dup) {
    // 命中回收站里的同 sha1:URL 路径全站唯一(文件仍在盘上),复活原行重新走 sharp 管线
    await prisma.media.update({
      where: { id: dup.id },
      data: { deletedAt: null, status: "processing" satisfies MediaStatus },
    });
    await enqueueMediaProcess(dup.id, sha1);
    return { id: dup.id.toString(), path: dup.path, reused: true, status: "processing" };
  }

  const now = new Date();
  const rel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${sha1}.${ext}`;
  const url = relToUploadsUrl(rel);
  await mediaStorage.put(rel, input.data);
  const row = await prisma.media.create({
    data: {
      path: url,
      filename: input.filename.slice(0, MEDIA_LIMITS.maxFilenameChars),
      kind: "image",
      status: "processing" satisfies MediaStatus,
      sizeBytes: BigInt(input.data.byteLength),
      sha1,
      storage: mediaStorageKind,
    },
  });
  await enqueueMediaProcess(row.id, sha1);
  return { id: row.id.toString(), path: url, reused: false, status: "processing" };
}

/** 单条删除(arch/08 §4:必须过引用检查):有引用拒绝并列出引用方;否则软删入回收站 */
export async function deleteMedia(id: bigint): Promise<{ path: string }> {
  const media = await prisma.media.findFirst({ where: { id, deletedAt: null } });
  if (!media) throw new MediaError("not_found", "媒体不存在");
  const refs = await prisma.mediaRef.findMany({
    where: { mediaPath: media.path },
    select: { post: { select: { title: true } } },
    take: 5,
  });
  if (refs.length > 0) {
    const names = refs.map((r) => `《${r.post.title}》`).join("、");
    throw new MediaError("referenced", `媒体仍被引用(${names} 等),请先移除文章中的引用`);
  }
  await prisma.media.update({
    where: { id },
    data: { status: "deleted" satisfies MediaStatus, deletedAt: new Date() },
  });
  return { path: media.path };
}

/** 批量删除(孤儿处置):逐条引用检查,有引用的跳过并在结果中列出 */
export async function batchDeleteMedia(ids: bigint[]): Promise<BatchDeleteResult> {
  const rows = await prisma.media.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, path: true, filename: true },
  });
  const refCounts = await prisma.mediaRef.groupBy({
    by: ["mediaPath"],
    where: { mediaPath: { in: rows.map((r) => r.path) } },
    _count: { mediaPath: true },
  });
  const countByPath = new Map(refCounts.map((g) => [g.mediaPath, g._count.mediaPath]));
  const deletable = rows.filter((r) => !countByPath.has(r.path));
  if (deletable.length > 0) {
    await prisma.media.updateMany({
      where: { id: { in: deletable.map((r) => r.id) } },
      data: { status: "deleted" satisfies MediaStatus, deletedAt: new Date() },
    });
  }
  return {
    deleted: deletable.length,
    skipped: rows
      .filter((r) => countByPath.has(r.path))
      .map((r) => ({
        id: r.id.toString(),
        filename: r.filename,
        refCount: countByPath.get(r.path) ?? 0,
      })),
  };
}

/**
 * 重复组合并(原型「保留 1 个并合并引用」;2026-10-06 验收反馈问题1):
 * keeper 取组内最早一条;正文引用(MediaRef)与封面(Post.coverPath)改指 keeper,
 * 同一文章已同时引用两份的引用行直接删除(防 (media_path, post_id) 主键冲突);
 * 其余副本软删入回收站(物理文件留待 audit 清退,URL 路径全站唯一不复活)。
 */
export async function mergeDupeGroup(sha1: string): Promise<DupeMergeResult> {
  const rows = await prisma.media.findMany({
    where: { sha1, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length < 2) throw new MediaError("not_found", "该 sha1 没有可合并的重复组");
  const [keeper, ...dupes] = rows;
  let movedRefs = 0;
  for (const dupe of dupes) {
    const refs = await prisma.mediaRef.findMany({
      where: { mediaPath: dupe.path },
      select: { postId: true },
    });
    for (const ref of refs) {
      const clash = await prisma.mediaRef.findUnique({
        where: { mediaPath_postId: { mediaPath: keeper.path, postId: ref.postId } },
        select: { postId: true },
      });
      if (clash) {
        await prisma.mediaRef.delete({
          where: { mediaPath_postId: { mediaPath: dupe.path, postId: ref.postId } },
        });
      } else {
        await prisma.mediaRef.update({
          where: { mediaPath_postId: { mediaPath: dupe.path, postId: ref.postId } },
          data: { mediaPath: keeper.path },
        });
        movedRefs += 1;
      }
    }
    const covers = await prisma.post.updateMany({
      where: { coverPath: dupe.path },
      data: { coverPath: keeper.path },
    });
    movedRefs += covers.count;
    await prisma.media.update({
      where: { id: dupe.id },
      data: { status: "deleted" satisfies MediaStatus, deletedAt: new Date() },
    });
  }
  return { keptId: keeper.id.toString(), keptPath: keeper.path, movedRefs, removed: dupes.length };
}

/** 一个媒体行的全部落盘文件(主文件 + WebP 副本 + 缩略图,同目录 sha1 家族) */
function diskFamily(relMain: string): string[] {
  const dot = relMain.lastIndexOf(".");
  const stem = dot > 0 ? relMain.slice(0, dot) : relMain;
  return [relMain, `${stem}.webp`, `${stem}.thumb.webp`];
}

/**
 * 回收站清退(物理删除;audit 定时清退与后台「立即清除」共用):
 * 先删文件家族再删记录——先删记录会丢文件线索,失败重跑补删。返回清退行数。
 */
export async function purgeDeletedMedia(
  rows: Array<{ id: bigint; path: string }>,
): Promise<number> {
  for (const row of rows) {
    const rel = uploadsUrlToRel(row.path);
    if (rel) {
      for (const f of diskFamily(rel)) await mediaStorage.delete(f);
    }
    await prisma.media.delete({ where: { id: row.id } });
  }
  return rows.length;
}

/** 回收站恢复:清 deletedAt,status 按实时引用口径重算(有引用 active / 无引用 orphan);
 *  文件在回收站窗口内未被清退,恢复即原 URL 复活,零拷贝。不在回收站的行 404。 */
export async function restoreMedia(id: bigint): Promise<MediaRestoreResult> {
  const media = await prisma.media.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!media) throw new MediaError("not_found", "媒体不在回收站中");
  const refSet = await loadReferencedPathSet();
  const status: MediaStatus = refSet.has(media.path) ? "active" : "orphan";
  await prisma.media.update({ where: { id }, data: { deletedAt: null, status } });
  return { id: media.id.toString(), path: media.path, status };
}

/** 回收站立即清除(单条 admin 显式动作;定时/批量清退走 audit → purgeDeletedMedia) */
export async function purgeMedia(id: bigint): Promise<MediaPurgeResult> {
  const media = await prisma.media.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!media) throw new MediaError("not_found", "媒体不在回收站中");
  await purgeDeletedMedia([{ id: media.id, path: media.path }]);
  return { id: media.id.toString(), path: media.path };
}
