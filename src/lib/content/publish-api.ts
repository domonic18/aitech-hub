/**
 * 发布 API service(M5-c,requirement §3.6「API 为核,MCP 为壳」):
 * upsertArticle 以 slug 幂等——同 slug 重发即更新,**恒落草稿**(M71 收紧:
 * 外部通道不持直发后门,发布/下架只走后台人工通道)。
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
import {
  POST_LIMITS,
  asContentOrigin,
  normalizeAsciiSlug,
  type ContentOrigin,
} from "./post-schema";
import { PostAdminError } from "./posts-admin";
import { createPost, updatePost } from "./posts-admin";

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
  title?: string;
  slug?: string;
  /** 封面站内路径(缺省取 frontmatter cover;仅认站内路径) */
  coverPath?: string;
  /** 显式入参 > frontmatter tags;超 5 个截断 */
  tags?: string[];
  /**
   * 创作方式合规标识(M71):缺省 ai_assisted(外部通道产出进草稿池待审,
   * 标 human 会把 AI 稿记成人工创作);显式声明时按声明取值。
   */
  contentOrigin?: ContentOrigin;
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

/**
 * actor.sub 是 user_account.id 的字符串形态(会话与 PAT 两路同义):作者归属列
 * 取该 id;非法值落 null(不写归属,不阻断发文)。
 */
function actorAuthorId(actor: AdminActor): bigint | null {
  try {
    const v = BigInt(actor.sub);
    return v > BigInt(0) ? v : null;
  } catch {
    return null;
  }
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
  // 显式入参优先(整包上传:封面图随包入库后回填站内路径)
  const coverPath =
    input.coverPath ?? (coverRaw !== undefined && coverRaw.startsWith("/") ? coverRaw : undefined);
  const seoTitle = fmString(fm, "seoTitle");
  const seoDescription = fmString(fm, "seoDescription");

  // ── 图片随文(M5-b 同管线):本地引用按名匹配上传,失败保留原链 ──
  const refs = extractImageRefs(body);
  const external = refs.filter((r) => r.external).map((r) => r.src);
  const uploads: UpsertUpload[] = [];
  const mapping: ImportMapping = {};
  for (const ref of refs.filter((r) => !r.external)) {
    // 已是站内路径(整包上传先传后写的图):无需再传,也不进 uploads 清单
    if (ref.src.startsWith("/")) continue;
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
      const created = await createPost(
        {
          title,
          slug,
          categorySlug,
          tags,
          contentMd,
          excerpt,
          coverPath,
          seoTitle,
          seoDescription,
          // 外部通道产出缺省 ai_assisted(M71 合规修正:原硬编码 human,靠后台
          // 补标——草稿池一深就漏标,AI 稿被记成人工创作)
          contentOrigin: input.contentOrigin ?? "ai_assisted",
          isPurchasable: false, // 付费/登录可见字段只在后台编辑器开放(M21 批⑤/补齐批)
          isLoginRequired: false,
        },
        actorAuthorId(input.actor),
      );
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
      // 未显式声明标识时保留既有值(后台改标不被冲掉)
      contentOrigin:
        input.contentOrigin ?? asContentOrigin(existing?.contentOrigin ?? "ai_assisted"),
      // 付费两列省略 = 不动(M21 批⑤:外部通道不触付费面,已配付费文更新不丢配置)
    });
    id = verdict.id;
    finalSlug = r.slug;
  }

  // M71:外部通道恒落草稿——发布/下架只走后台人工通道
  const status = "draft";

  logger.info({
    event: "article.upsert",
    actor: input.actor,
    action: verdict.action,
    id: id.toString(),
    slug: finalSlug,
    contentOrigin: input.contentOrigin ?? "ai_assisted",
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
