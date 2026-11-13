/**
 * .md 整包上传(M71,K3 复活):外部 agent 交「一篇 .md + 若干配图」一次成稿。
 *
 * 为什么单开一条路:既有 upsert_article 收文本 + base64 图,大图过模型上下文
 * 是明令禁止的;单独 curl /api/media 再贴路径则要 agent 自己编排多步。
 * 整包入口把「读 md → 按名匹配图片 → 上传入库(sha1 去重)→ 替换引用 →
 * 落草稿」压成一次调用,字节不过模型上下文。
 *
 * 口径:图文替换复用 media/import-md 的纯函数(与后台一键发文同一实现);
 * 产出恒落草稿、contentOrigin 缺省 ai_assisted(与 upsert_article 同)。
 */
import type { AdminActor } from "@/lib/http/mutation-guard";
import {
  extractImageRefs,
  refBasename,
  replaceImageRefs,
  type ImportMapping,
} from "@/lib/media/import-md";
import { uploadMedia } from "@/lib/media/service";
import { logger } from "@/lib/logger";

import { fmString, parseFrontmatter } from "./frontmatter";
import { upsertArticle, type UpsertArticleResult, type UpsertUpload } from "./publish-api";

/** 整包里的一张附件(已读入内存的字节) */
export interface BundleFile {
  name: string;
  /** 仅作展示提示:入库 mime 以魔数嗅探为唯一裁决(M27 批⑦) */
  mime: string;
  data: Uint8Array;
}

/** 单批图片数上限(与外链转存批同量级,防滥用;超出提示分批上传) */
export const BUNDLE_IMAGES_MAX = 30;

/** .md 正文上限(与 post-schema POST_LIMITS.contentMd 同量级) */
export const BUNDLE_MD_MAX = 500_000;

function isExternal(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** 按文件名匹配附件(md 里的相对路径只取 basename,与一键发文同口径) */
function matchByName(files: BundleFile[], src: string): BundleFile | undefined {
  const base = refBasename(src);
  return files.find((f) => refBasename(f.name) === base);
}

/**
 * 整包发文:md 文本 + 附件列表 → 草稿。
 * 未匹配到的本地引用保留原链并在 uploads 里给出原因(不静默丢图);
 * 外链引用保留原链(一期不转存,与 upsert_article 同)。
 */
export async function importMdBundle(input: {
  md: string;
  files: BundleFile[];
  actor: AdminActor;
}): Promise<UpsertArticleResult> {
  const { fm } = parseFrontmatter(input.md);
  const refs = extractImageRefs(input.md);
  const mapping: ImportMapping = {};
  const uploads: UpsertUpload[] = [];

  for (const ref of refs) {
    if (isExternal(ref.src)) continue; // 外链:保留原链
    if (ref.src.startsWith("/")) continue; // 已是站内路径:无需再传
    const file = matchByName(input.files, ref.src);
    if (!file) {
      mapping[ref.src] = null;
      uploads.push({ src: ref.src, path: null, reason: "no_matching_file" });
      continue;
    }
    try {
      const saved = await uploadMedia({ data: file.data, mime: file.mime, filename: file.name });
      mapping[ref.src] = saved.path;
      uploads.push({ src: ref.src, path: saved.path, reused: saved.reused });
    } catch (e) {
      mapping[ref.src] = null;
      uploads.push({
        src: ref.src,
        path: null,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 封面:frontmatter 的 cover 指本地附件时一并入库(与正文图同管线)
  const coverRaw = fmString(fm, "cover");
  let coverPath: string | undefined;
  if (coverRaw && !coverRaw.startsWith("/") && !isExternal(coverRaw)) {
    const file = matchByName(input.files, coverRaw);
    if (!file) {
      uploads.push({ src: coverRaw, path: null, reason: "no_matching_file" });
    } else {
      try {
        const saved = await uploadMedia({ data: file.data, mime: file.mime, filename: file.name });
        coverPath = saved.path;
        uploads.push({ src: coverRaw, path: saved.path, reused: saved.reused });
      } catch (e) {
        uploads.push({
          src: coverRaw,
          path: null,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  const markdown = replaceImageRefs(input.md, mapping);
  const result = await upsertArticle({
    markdown,
    ...(coverPath !== undefined ? { coverPath } : {}),
    actor: input.actor,
  });
  logger.info({
    event: "article.bundle",
    actor: input.actor,
    id: result.id,
    slug: result.slug,
    files: input.files.length,
    uploads: uploads.length,
  });
  return { ...result, uploads };
}
