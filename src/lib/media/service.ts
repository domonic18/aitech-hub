/**
 * 媒体写侧 service(M5-b;arch/08-media §3.4 + arch/05-services §4.2):
 * 上传入库(sha1 去重 → 本地卷 → enqueue sharp 管线)、删除(引用检查 + 软删回收站)、
 * 批量删除(孤儿处置)。读侧(列表/详情/统计/断链)见同目录 queries.ts。
 * 副作用编排(enqueue)与 revalidate 同款纪律:写库成功后再投递,任务幂等可重放。
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import {
  IMAGE_MIME_WHITELIST,
  MEDIA_LIMITS,
  extByMime,
  type BatchDeleteResult,
  type MediaStatus,
} from "@/lib/media/media-schema";
import { getQueue, QUEUE_MEDIA_PROCESS } from "@/lib/queue";
import { mediaStorage, relToUploadsUrl } from "@/lib/media/storage";

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
    { jobId: `media:${sha1}:process`, attempts: 3, backoff: { type: "exponential", delay: 5_000 } },
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
      storage: "local",
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
