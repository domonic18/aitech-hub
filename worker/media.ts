/**
 * media 队列处理器(M5-b;arch/08-media §3.4 + arch/05-services §4.2):
 * - media.process:sharp 出 WebP 副本(q80)+ 640w 缩略图,回填宽高与 sha1,置 active;
 * - media.transfer:抓取外链图 → uploadMedia 入库(sha1 去重)→ 链式复用 process;
 *   单条失败不拖垮整批,失败项在 returnvalue 里标 null 供导入弹窗提示。
 * 幂等:process 以 `media:{sha1}:process` 为 jobId 去重;重跑重算结果一致。
 */
import type { Job } from "bullmq";

import { prisma } from "../src/lib/db";
import { type MediaStatus, type TransferResult, MEDIA_LIMITS } from "../src/lib/media/media-schema";
import { uploadMedia } from "../src/lib/media/service";
import { mediaStorage, uploadsUrlToRel } from "../src/lib/media/storage";

/** URL 路径 → 缩略图 URL(同目录 `<sha1>.thumb.webp`;主图非图片族不存在缩略图) */
function thumbUrlOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return `${path.slice(0, dot)}.thumb.webp`;
}

export async function processMediaJob(job: Job): Promise<{ id: string; status: string }> {
  const mediaId = BigInt(job.data.mediaId as string);
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media || media.deletedAt !== null) {
    return { id: mediaId.toString(), status: "skipped" };
  }
  const rel = uploadsUrlToRel(media.path);
  if (!rel) throw new Error(`非法媒体路径:${media.path}`);
  const input = await mediaStorage.get(rel);
  if (!input) throw new Error(`源文件缺失:${media.path}`);

  // 延迟 require:sharp 为原生模块,worker 进程独占加载,web 侧不进 bundle
  const sharp = (await import("sharp")).default;
  const meta = await sharp(input).metadata();
  const width = meta.width ?? null;
  const height = meta.height ?? null;

  // WebP 副本(gif 保动画;webp 源无需副本)
  if (media.path.endsWith(".webp") === false) {
    const webp = await sharp(input, { animated: meta.pages !== undefined })
      .webp({
        quality: MEDIA_LIMITS.webpQuality,
      })
      .toBuffer();
    const dot = rel.lastIndexOf(".");
    await mediaStorage.put(`${rel.slice(0, dot)}.webp`, webp);
  }

  // 缩略图 640w(webp;竖图按比例缩高)
  const thumb = await sharp(input, { animated: false })
    .resize({ width: MEDIA_LIMITS.thumbWidth, withoutEnlargement: true })
    .webp({ quality: MEDIA_LIMITS.webpQuality })
    .toBuffer();
  const thumbRel = `${rel.slice(0, rel.lastIndexOf("."))}.thumb.webp`;
  await mediaStorage.put(thumbRel, thumb);

  await prisma.media.update({
    where: { id: mediaId },
    data: {
      width,
      height,
      thumbPath: thumbUrlOf(media.path),
      status: "active" satisfies MediaStatus,
    },
  });
  return { id: mediaId.toString(), status: "active" };
}

/**
 * 单张外链抓取:content-type 白名单 + 大小上限(与上传同规)。
 * SSRF 边界(评审 S1):URL 仅来自 admin 后台(会话 + Origin 双守卫),风险有界;
 * 开放多管理员/三方导入前需先解析 DNS 并拒绝私网段(二期硬化项)。
 */
async function fetchExternalImage(url: string): Promise<{ data: Uint8Array; mime: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(MEDIA_LIMITS.fetchTimeoutMs),
    headers: { "user-agent": "aitech-hub-media-transfer/1.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MEDIA_LIMITS.maxFetchBytes) throw new Error("超过大小上限");
  return { data: buf, mime: mime || "application/octet-stream" };
}

export async function transferMediaJob(job: Job): Promise<TransferResult> {
  const urls = job.data.urls as string[];
  const mapping: Record<string, string | null> = {};
  let ok = 0;
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    try {
      const { data, mime } = await fetchExternalImage(url);
      const saved = await uploadMedia({
        data,
        mime,
        filename: url.split("/").pop()?.slice(0, MEDIA_LIMITS.maxFilenameChars) || "transfer",
      });
      mapping[url] = saved.path;
      ok += 1;
    } catch (err) {
      mapping[url] = null; // 失败保留原链,导入弹窗提示(arch/05 §4.2)
      failed += 1;
      console.warn(
        JSON.stringify({ event: "media.transfer.failed", jobId: job.id, url, error: String(err) }),
      );
    }
    await job.updateProgress(Math.round(((i + 1) / urls.length) * 100));
  }
  return { mapping, ok, failed };
}
