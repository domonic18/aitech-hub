/**
 * 发布 API service(M5-c,requirement §3.6「API 为核,MCP 为壳」):
 * upsertArticle 以 slug 幂等——同 slug 重发即更新,默认落草稿。
 * 字段优先级:显式入参 > frontmatter > 缺省(title 缺失 400;分类缺省
 * blog;slug 缺省由标题派生 ASCII,纯中文标题 → bare-id,该篇无幂等键)。
 * 图片随文复用 M5-b 一键发文同一管线:extractImageRefs → refBasename
 * 按名匹配所选文件 → uploadMedia(sha1 去重)→ replaceImageRefs;外链
 * 一期保留原链并随响应返回清单(转存二期)。
 */
import { isP2002, prisma } from "@/lib/db";
import type { AdminActor } from "@/lib/http/mutation-guard";
import {
  extractImageRefs,
  refBasename,
  replaceImageRefs,
  type ImportMapping,
} from "@/lib/media/import-md";
import { uploadMedia } from "@/lib/media/service";
import { logger } from "@/lib/logger";

import { fmString, fmStringArray, parseFrontmatter } from "./frontmatter";
import { postPath } from "./post-path";
import { POST_LIMITS, asContentOrigin, normalizeAsciiSlug } from "./post-schema";
import { PostAdminError } from "./posts-admin";
import { createPost, publishPost, updatePost } from "./posts-admin";

export const DEFAULT_CATEGORY_SLUG = "blog";

export interface PublishApiImage {
  name: string;
  mime: string;
  dataBase64: string;
}

export interface UpsertArticleInput {
  /** 原始 markdown(可含 frontmatter;入库正文为剥除围栏后的 body) */
  markdown: string;
  images?: PublishApiImage[];
  categorySlug?: string;
  /** true → 落草稿后立即发布(requirement §3.6 默认草稿) */
  publish?: boolean;
  title?: string;
  slug?: string;
  /** 显式入参 > frontmatter tags;超 5 个截断 */
  tags?: string[];
  actor: AdminActor;
}

export interface UpsertUpload {
  /** 原始引用 src */
  src: string;
  /** 入库后站内路径;null = 保留原链(附 reason) */
  path: string | null;
  reused?: boolean;
  reason?: string;
}

export interface UpsertArticleResult {
  action: "created" | "updated";
  id: string;
  slug: string | null;
  /** URL 终态 /post/<id>-<slug>(bare-id 时 /post/<id>) */
  url: string;
  status: string;
  uploads: UpsertUpload[];
  /** 一期保留原链的外链引用清单 */
  external: string[];
}

/**
 * slug 归一走 post-schema 唯一实现;超长(折叠后)→ undefined(bare-id)。
 * 折叠只缩短:入参边界已限 raw ≤ POST_LIMITS.slug(publishUpsertShape),
 * 此长度检查为防御性兜底。
 */
function foldSlug(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const s = normalizeAsciiSlug(raw);
  return s !== undefined && s.length > POST_LIMITS.slug ? undefined : s;
}

/**
 * upsert 分支裁定(纯函数,单测钉行为):
 * 不存在 → create;slug 被软删占用 → 409;残留 HTML 旧文 → 409 不绕过
 * (旧文保真红线跨通道一致);其余 → update。
 */
export function resolveUpsertAction(
  existing: { id: bigint; status: string; contentMd: string | null } | null,
): { action: "create" } | { action: "update"; id: bigint } {
  if (existing === null) return { action: "create" };
  if (existing.status === "deleted")
    throw new PostAdminError("slug_conflict", "slug 被已删除文章占用");
  if (existing.contentMd === null)
    throw new PostAdminError(
      "legacy_readonly",
      "旧文保真:HTML 正文不可经 API 改写,请先在后台转 Markdown",
    );
  return { action: "update", id: existing.id };
}

export async function upsertArticle(input: UpsertArticleInput): Promise<UpsertArticleResult> {
  const { fm, body } = parseFrontmatter(input.markdown);

  const title = input.title ?? fmString(fm, "title");
  if (!title) throw new PostAdminError("invalid_body", "title 缺失(显式入参或 frontmatter)");
  const slug = input.slug !== undefined ? foldSlug(input.slug) : foldSlug(fmString(fm, "slug"));
  const categorySlug = input.categorySlug ?? fmString(fm, "category") ?? DEFAULT_CATEGORY_SLUG;
  const tags = (input.tags ?? fmStringArray(fm, "tags") ?? []).slice(0, POST_LIMITS.tagsMax);
  const excerpt = fmString(fm, "excerpt");
  const coverRaw = fmString(fm, "cover");
  const coverPath = coverRaw !== undefined && coverRaw.startsWith("/") ? coverRaw : undefined;
  const seoTitle = fmString(fm, "seoTitle");
  const seoDescription = fmString(fm, "seoDescription");

  // ── 图片随文(M5-b 同管线):本地引用按名匹配上传,失败保留原链 ──
  const refs = extractImageRefs(body);
  const external = refs.filter((r) => r.external).map((r) => r.src);
  const uploads: UpsertUpload[] = [];
  const mapping: ImportMapping = {};
  for (const ref of refs.filter((r) => !r.external)) {
    const file = (input.images ?? []).find((img) => img.name === refBasename(ref.src));
    if (!file) {
      mapping[ref.src] = null;
      uploads.push({ src: ref.src, path: null, reason: "no_matching_file" });
      continue;
    }
    try {
      const data = new Uint8Array(Buffer.from(file.dataBase64, "base64"));
      const saved = await uploadMedia({ data, mime: file.mime, filename: file.name });
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
  const contentMd = replaceImageRefs(body, mapping);

  // ── slug 幂等裁定与落库 ──
  // 幂等键 = 解析后的 slug;bare-id(无 slug)每次新建,响应内注记 action=created
  const existing = slug
    ? await prisma.post.findUnique({
        where: { slug },
        select: { id: true, status: true, contentMd: true, contentOrigin: true },
      })
    : null;
  const verdict = resolveUpsertAction(existing);

  let id: bigint;
  let finalSlug: string | null;
  if (verdict.action === "create") {
    try {
      const created = await createPost({
        title,
        slug,
        categorySlug,
        tags,
        contentMd,
        excerpt,
        coverPath,
        seoTitle,
        seoDescription,
        contentOrigin: "human", // 外部发布通道缺省人工;AI 系标识在后台编辑器补记
        isPurchasable: false, // 付费字段只在后台编辑器开放(M21 批⑤)
      });
      id = created.id;
      finalSlug = created.slug;
    } catch (e) {
      if (isP2002(e)) throw new PostAdminError("slug_conflict", "slug 已存在(并发写入)");
      throw e;
    }
  } else {
    // slug 是幂等键,更新不携带(改 slug 走后台编辑器)
    const r = await updatePost(verdict.id, {
      title,
      categorySlug,
      tags,
      contentMd,
      excerpt,
      coverPath,
      seoTitle,
      seoDescription,
      contentOrigin: asContentOrigin(existing?.contentOrigin ?? "human"), // 更新不携带标识,保留后台改标不被冲掉
      // 付费两列省略 = 不动(M21 批⑤:外部通道不触付费面,已配付费文更新不丢配置)
    });
    id = verdict.id;
    finalSlug = r.slug;
  }

  let status = "draft";
  if (input.publish) {
    await publishPost(id);
    status = "published";
  } else {
    const row = await prisma.post.findUnique({ where: { id }, select: { status: true } });
    status = row?.status ?? "draft";
  }

  logger.info({
    event: "article.upsert",
    actor: input.actor,
    action: verdict.action,
    id: id.toString(),
    slug: finalSlug,
    publish: input.publish === true,
    uploads: uploads.length,
  });

  return {
    action: verdict.action === "create" ? "created" : "updated",
    id: id.toString(),
    slug: finalSlug,
    url: postPath(id, finalSlug),
    status,
    uploads,
    external,
  };
}
