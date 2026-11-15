/**
 * POST /api/posts/bundles — .md **批量**整包上传(M72 B1):
 * multipart 里交「若干篇 .md + 共享图池」,逐篇按文件名匹配图片 → 上传入库
 * (sha1 去重)→ 替换引用 → 落草稿。产出恒落草稿待人工审核。
 *
 * 与单篇 /api/posts/bundle 的分工:单篇收「一篇 md + 它的图」;本路由收
 * 「一批 md + 一池图」——线下写作助手一周多篇时不必逐篇往返(图片字节
 * 仍不过模型上下文:图走 multipart 文件,不经 MCP base64)。
 *
 * 图池共享的约定:图片按**文件名**匹配引用,故文件名宜带篇名前缀
 * (如 `my-slug-cover.png`);同名不同图会被后篇覆盖成同一张,回报里可见
 * (uploads 的 reason=no_matching_file / 命中情况逐篇列出)。
 */
import { type NextRequest } from "next/server";

import {
  BUNDLE_IMAGES_MAX,
  BUNDLE_MD_MAX,
  importMdBundle,
  type BundleFile,
} from "@/lib/content/bundle-import";
import { requireAdminActor } from "@/lib/http/mutation-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { MEDIA_LIMITS } from "@/lib/media/media-schema";

export const dynamic = "force-dynamic";

/** multipart 字段名:md 文件(可重复) / 图片文件(可重复,共享池) */
const BUNDLE_MDS_FIELD = "mds";
const BUNDLE_FILES_FIELD = "files";

/** 单批篇数上限(一次别铺太宽:失败时按篇回报,便于逐篇重试) */
const BUNDLE_POSTS_MAX = 20;

export async function POST(req: NextRequest) {
  const actorGuard = await requireAdminActor(req);
  if (!actorGuard.ok) return actorGuard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiEnvelope(400, "invalid multipart body");
  }

  const mdEntries = form.getAll(BUNDLE_MDS_FIELD).filter((v): v is File => v instanceof File);
  if (mdEntries.length === 0) {
    return apiEnvelope(400, `缺少文件字段 ${BUNDLE_MDS_FIELD}`);
  }
  if (mdEntries.length > BUNDLE_POSTS_MAX) {
    return apiEnvelope(400, `单批不超过 ${BUNDLE_POSTS_MAX} 篇,请分批上传`);
  }
  const tooLargeMd = mdEntries.find((f) => f.size > BUNDLE_MD_MAX);
  if (tooLargeMd !== undefined) {
    return apiEnvelope(400, `.md 超过 ${BUNDLE_MD_MAX} 字符上限`);
  }

  const fileEntries = form.getAll(BUNDLE_FILES_FIELD).filter((v): v is File => v instanceof File);
  if (fileEntries.length > BUNDLE_IMAGES_MAX) {
    return apiEnvelope(400, `单批图片不超过 ${BUNDLE_IMAGES_MAX} 张,请分批上传`);
  }
  const tooLarge = fileEntries.find((f) => f.size > MEDIA_LIMITS.maxUploadBytes);
  if (tooLarge) {
    return apiEnvelope(400, `单图不超过 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB`);
  }

  const files: BundleFile[] = await Promise.all(
    fileEntries.map(async (f) => ({
      name: f.name || "upload",
      mime: f.type || "application/octet-stream",
      data: new Uint8Array(await f.arrayBuffer()),
    })),
  );

  // 逐篇入库:一篇失败不拖累其余(回报里逐篇给 ok/error)
  const items: Array<{
    index: number;
    name: string;
    ok: boolean;
    id?: string;
    slug?: string | null;
    url?: string;
    action?: string;
    status?: string;
    error?: string;
  }> = [];
  for (const [index, entry] of mdEntries.entries()) {
    const md = await entry.text();
    try {
      const result = await importMdBundle({ md, files, actor: actorGuard.actor });
      items.push({
        index,
        name: entry.name || `post-${String(index + 1)}`,
        ok: true,
        id: result.id,
        slug: result.slug,
        url: result.url,
        action: result.action,
        status: result.status,
      });
      logger.info({
        event: "article.bundle.batch.item",
        actor: actorGuard.actor,
        id: result.id,
        slug: result.slug,
        files: files.length,
      });
    } catch (e) {
      items.push({
        index,
        name: entry.name || `post-${String(index + 1)}`,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const okCount = items.filter((i) => i.ok).length;
  logger.info({
    event: "article.bundle.batch",
    actor: actorGuard.actor,
    posts: items.length,
    ok: okCount,
    files: files.length,
  });
  return apiEnvelope(0, "enqueued", {
    count: items.length,
    ok: okCount,
    failed: items.length - okCount,
    items,
  });
}
