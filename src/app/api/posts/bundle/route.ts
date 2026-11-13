/**
 * POST /api/posts/bundle — .md 整包上传(M71,K3 复活):
 * multipart 里交「一篇 .md + 若干配图」,服务端读 md → 按文件名匹配图片 →
 * 上传入库(sha1 去重)→ 替换引用 → 落草稿。产出恒落草稿待人工审核。
 *
 * 与 upsert_article 的分工:后者收文本 + base64 图(仅 <100KB 小图);
 * 本路由收真实文件,字节不过模型上下文——大图走这里。
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

import { postErrorResponse } from "../shared";

export const dynamic = "force-dynamic";

/** multipart 字段名:md 文件 / 图片文件(可重复) */
const BUNDLE_MD_FIELD = "md";
const BUNDLE_FILES_FIELD = "files";

export async function POST(req: NextRequest) {
  const actorGuard = await requireAdminActor(req);
  if (!actorGuard.ok) return actorGuard.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiEnvelope(400, "invalid multipart body");
  }

  const mdEntry = form.get(BUNDLE_MD_FIELD);
  if (!(mdEntry instanceof File)) {
    return apiEnvelope(400, `缺少文件字段 ${BUNDLE_MD_FIELD}`);
  }
  if (mdEntry.size > BUNDLE_MD_MAX) {
    return apiEnvelope(400, `.md 超过 ${BUNDLE_MD_MAX} 字符上限`);
  }

  const entries = form.getAll(BUNDLE_FILES_FIELD).filter((v): v is File => v instanceof File);
  if (entries.length > BUNDLE_IMAGES_MAX) {
    return apiEnvelope(400, `单批图片不超过 ${BUNDLE_IMAGES_MAX} 张,请分批上传`);
  }
  const tooLarge = entries.find((f) => f.size > MEDIA_LIMITS.maxUploadBytes);
  if (tooLarge) {
    return apiEnvelope(400, `单图不超过 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB`);
  }

  const md = await mdEntry.text();
  const files: BundleFile[] = await Promise.all(
    entries.map(async (f) => ({
      name: f.name || "upload",
      mime: f.type || "application/octet-stream",
      data: new Uint8Array(await f.arrayBuffer()),
    })),
  );

  try {
    const result = await importMdBundle({ md, files, actor: actorGuard.actor });
    logger.info({
      event: "article.bundle",
      actor: actorGuard.actor,
      id: result.id,
      slug: result.slug,
      files: files.length,
    });
    return apiEnvelope(0, result.action, result);
  } catch (e) {
    return postErrorResponse(e);
  }
}
