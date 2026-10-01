/**
 * 媒体引用追踪(arch/08-media §3.1:所有清洗的地基)。
 * 文章保存时由写侧 service 调用 syncMediaRefs:解析正文(md 图片/视频语法 + 旧文 HTML
 * img/video 标签)与封面 cover_path,提取站内媒体路径,先删后插该文的引用行。
 * 迁移脚本 load 阶段建的 1341 行与本逻辑同源(闭包口径一致)。
 */
import type { Prisma } from "@prisma/client";

import { normalizeUrlPath } from "@/lib/slug";

/** 站内媒体路径前缀(一期本地卷;二期 COS 域也在站内路径语义内再扩) */
const SITE_MEDIA_PREFIXES = ["/wp-content/uploads/", "/media/"];

function isSiteMediaPath(p: string): boolean {
  return SITE_MEDIA_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** 归一化单个引用:仅收站内路径,统一 percent-encoded 小写形态(与 DB path 口径一致) */
function normalizeRef(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null; // 相对/协议外链不是站内资产
  if (!isSiteMediaPath(normalizeUrlPath(trimmed))) return null;
  return normalizeUrlPath(trimmed);
}

/**
 * 提取一篇文章引用的全部站内媒体路径(去重):
 * - Markdown:图片 `![alt](src)` 与 GFM 视频/裸链接不收,仅图片语法;
 * - HTML(旧文保真正文):img/video/source 的 src;
 * - 封面 cover_path 一并纳入(arch/08-media §3.1)。
 */
export function extractMediaRefs(input: {
  contentMd?: string | null;
  contentHtml?: string | null;
  coverPath?: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined | null): void => {
    if (!raw) return;
    const ref = normalizeRef(raw);
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  };

  if (input.contentMd) {
    const md = input.contentMd;
    for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) push(m[1]);
  }
  if (input.contentHtml) {
    for (const m of input.contentHtml.matchAll(/<(?:img|video|source)\b[^>]*?\bsrc="([^"]+)"/gi)) {
      push(m[1]);
    }
  }
  push(input.coverPath);
  return out;
}

type Tx = Pick<Prisma.TransactionClient, "mediaRef">;

/** 先删后插(arch/08-media §3.1);在文章写事务内调用,保引用与正文原子一致 */
export async function syncMediaRefs(tx: Tx, postId: bigint, refs: string[]): Promise<void> {
  await tx.mediaRef.deleteMany({ where: { postId } });
  if (refs.length > 0) {
    await tx.mediaRef.createMany({
      data: refs.map((mediaPath) => ({ mediaPath, postId })),
      skipDuplicates: true,
    });
  }
}
