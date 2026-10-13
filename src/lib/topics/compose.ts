/**
 * 专题文章生产·确定性写核(M26 批④建;M27 批⑤重构为 agent 自主生产的共享库):
 * 素材块拼装(get_topic_brief 工具消费)+ 封面转存 + 落稿锚定(linkedPostId/
 * composedAt/状态流转,save_topic_draft 工具消费)。编排权在会话 agent(细粒度
 * 工具逐项执行,工具面在 lib/agent/topic-tools),本模块只提供写侧确定性核;
 * 四步固定管线(批③ compose-agent)与单调用合成已退役。落稿 = content_post
 * 草稿(contentOrigin=ai_assisted,默认分类 report「产品评测」缺则幂等补建,
 * 标签缺省带专题标题)→ topic 锚定 linkedPostId+composedAt、collecting→drafted
 * (§10-7)。M27 批②:视频封面转存入站内媒体库落 post.coverPath(站点头图 +
 * 公众号大图;转存失败降级 null 不阻塞落稿),文首视频推荐卡仍确定性注入
 * (buildVideoCard)。重合成保护(§10-3):linked 文档 updatedAt > composedAt
 * (或从未合成过的人工关联)即人工动过 → 工具层需 confirm;linked 已软删 →
 * 弃锚新建。SEO/标签仅在 save 工具显式提供时触碰(缺省保人工已改字段)。
 */
import type { Topic, TopicItem } from "@prisma/client";

import { POST_LIMITS } from "../content/post-schema";
import { PostAdminError, createPost, upsertTags } from "../content/posts-admin";
import { fetchExternalImage } from "../media/fetch-external";
import { uploadMedia } from "../media/service";
import { logger } from "../logger";
import { prisma } from "../db";
import { hydrateItems } from "./repo";

// ── 素材块(原 compose-prompt 纯函数段,M27 批⑤并档)──────────────

/** 合成素材块(hydrateItems 同源取数,post 块额外带摘要与正文取样) */
export interface ComposeMaterialBlock {
  kind: "telegram" | "post";
  title: string;
  blogger: string | null;
  /** 人工批注(合成取舍指令,原样注入) */
  note: string | null;
  /** 解读笔记(§4:优先;null=存量/降级轮次 → 降级拼装) */
  aiNote: string | null;
  aiSummary: string | null;
  aiPoints: string[];
  /** telegram 块:原视频链接与封面图(供写作引用/CTA);post 块恒 null */
  videoUrl: string | null;
  coverUrl: string | null;
  /** post 块:摘要与正文取样(telegram 块恒 null) */
  excerpt: string | null;
  contentSample: string | null;
}

/** post 正文取样上限(get_topic_brief 只需主题级引用,不整篇灌入) */
export const COMPOSE_POST_SAMPLE_MAX = 2000;

/** aiPoints Json 列读侧归一(白名单字符串;同 feed-view 投影哲学) */
export function normalizePoints(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === "string" && p.trim() !== "")
    : [];
}

/** 素材块拼装(hydrate + post 摘要/正文取样补取) */
export async function buildComposeBlocks(
  topic: Topic & { items: TopicItem[] },
): Promise<ComposeMaterialBlock[]> {
  const materials = await hydrateItems(topic.items);
  const postIds = topic.items.filter((i) => i.itemType === "post").map((i) => i.itemId);
  const postRows = postIds.length
    ? await prisma.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, title: true, excerpt: true, contentMd: true },
      })
    : [];
  const postMap = new Map(postRows.map((r) => [r.id, r]));

  const blocks: ComposeMaterialBlock[] = [];
  for (const item of topic.items) {
    const m = materials.get(item.id);
    if (!m) continue;
    if (item.itemType === "telegram" && m.telegram) {
      blocks.push({
        kind: "telegram",
        title: m.telegram.title ?? "(无标题)",
        blogger: m.telegram.videoBlogger,
        note: item.note,
        aiNote: m.telegram.aiNote,
        aiSummary: m.telegram.aiSummary,
        aiPoints: normalizePoints(m.telegram.aiPoints),
        videoUrl: m.telegram.url,
        coverUrl: m.telegram.videoCoverUrl ?? null,
        excerpt: null,
        contentSample: null,
      });
    } else if (item.itemType === "post" && m.post) {
      const detail = postMap.get(m.post.id);
      blocks.push({
        kind: "post",
        title: detail?.title ?? m.post.title ?? "(无标题)",
        blogger: null,
        note: item.note,
        aiNote: null,
        aiSummary: null,
        aiPoints: [],
        videoUrl: null,
        coverUrl: null,
        excerpt: detail?.excerpt ?? null,
        contentSample: detail?.contentMd?.slice(0, COMPOSE_POST_SAMPLE_MAX) ?? null,
      });
    }
  }
  return blocks;
}

/**
 * 文首推荐卡(M27 批②):确定性注入不依赖模型,置正文最顶。封面不进正文
 * (站点头图/公众号大图均走 post.coverPath,避免双端重复);纯文字引用卡在
 * 公众号渲染为主题色块,站点渲染为引用框。无视频素材返回 null 不注入。
 */
export function buildVideoCard(blocks: ComposeMaterialBlock[]): string | null {
  const v = blocks.find((b) => b.kind === "telegram");
  if (!v) return null;
  return (
    `> 📺 本文推荐视频:《${v.title}》· UP主:${v.blogger ?? "未知"}` +
    " ——文末「阅读原文」可进站直达原视频"
  );
}

// ── 落稿锚定核(save_topic_draft 工具消费)────────────────────

/** 重合成保护判定(§10-3 纯函数):有人工关联但从未合成过,或合成后被编辑过 → 需确认 */
export function needsRecomposeConfirm(
  topic: Pick<Topic, "linkedPostId" | "composedAt">,
  linkedPost: { status: string; updatedAt: Date } | null,
): boolean {
  if (!topic.linkedPostId || !linkedPost) return false;
  if (linkedPost.status === "deleted") return false; // 软删弃锚,走新建
  if (topic.composedAt === null) return true; // 人工关联未合成过:覆盖即破坏
  return linkedPost.updatedAt.getTime() > topic.composedAt.getTime();
}

/** 落稿正文(工具入参经列帽截断后传入) */
export interface TopicDraft {
  title: string;
  excerpt: string;
  contentMd: string;
}

/** 落稿附加字段(M27 批⑤):undefined = 不触碰(保人工已改);null = 清空 */
export interface TopicDraftExtra {
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** 缺省(undefined)= 更新不动标签 / 新建回退专题标题标签 */
  tags?: string[];
}

export interface ComposeOutcome {
  postId: bigint;
  postTitle: string;
  /** true=覆盖既有关联文档;false=新建草稿 */
  recomposed: boolean;
  /** 封面结果(null=未提供或转存失败降级;可后补,不回滚落稿) */
  coverPath: string | null;
}

/** 封面文件名取 URL 末段(仅展示列,存储路径按 sha1 命名;解析失败兜底常量) */
function coverFilename(coverUrl: string): string {
  try {
    const last = decodeURIComponent(new URL(coverUrl).pathname.split("/").pop() ?? "");
    return (last.trim() === "" ? "video-cover" : last).slice(0, 80);
  } catch {
    return "video-cover";
  }
}

/**
 * 首视频封面转存(M27 批②):外链抓取 + 入站内媒体库 → /uploads 路径。
 * B 站图床有防盗链,站点/公众号直引外链会裂图,转存是双端显示与同步门的地基。
 * 任何失败降级 null 不抛——封面可后补,不回滚落稿。
 */
export async function transferCoverOrNull(coverUrl: string): Promise<string | null> {
  try {
    const { data, mime } = await fetchExternalImage(coverUrl);
    const r = await uploadMedia({ data, mime, filename: coverFilename(coverUrl) });
    return r.path;
  } catch (e) {
    logger.warn({
      event: "topic.compose_cover_failed",
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** 默认分类(§10-4:分类「产品评测」可改;slug 为站内既有种子,缺则幂等补建) */
const DEFAULT_CATEGORY_SLUG = "report";
const DEFAULT_CATEGORY_NAME = "产品评测";

async function ensureDefaultCategory(): Promise<void> {
  const existing = await prisma.category.findUnique({
    where: { slug: DEFAULT_CATEGORY_SLUG },
    select: { id: true },
  });
  if (existing) return;
  await prisma.category.create({
    data: { name: DEFAULT_CATEGORY_NAME, slug: DEFAULT_CATEGORY_SLUG },
  });
}

/** 标签缺省=专题标题(§10-4「标签带专题关键词」最直取实现;超列帽截断) */
function topicTag(title: string): string[] {
  const t = title.trim();
  return t === "" ? [] : [t.slice(0, POST_LIMITS.tag)];
}

/**
 * 落稿锚定:推荐卡注入 → linked 分流(覆盖 / 新建草稿)→ topic 锚定 + 状态
 * 流转。覆盖分支:SEO/标签仅在 extra 显式提供时触碰(未提供保人工已改字段),
 * 与 topic 锚定同事务原子。落稿失败(PostAdminError 等)可能留下无锚草稿——
 * 重落会覆盖同一篇(标题派生 slug 撞候选尽抛错),可重试。
 */
export async function finalizeCompose(
  topic: Topic & { items: TopicItem[] },
  draft: TopicDraft,
  blocks: ComposeMaterialBlock[],
  coverPath: string | null,
  extra: TopicDraftExtra = {},
): Promise<ComposeOutcome> {
  const cardMd = buildVideoCard(blocks);
  const finalMd = cardMd ? `${cardMd}\n\n${draft.contentMd}` : draft.contentMd;

  const linked =
    topic.linkedPostId !== null
      ? await prisma.post.findUnique({
          where: { id: topic.linkedPostId },
          select: { id: true, status: true },
        })
      : null;

  if (linked && linked.status !== "deleted") {
    const tagLinks = extra.tags ? await upsertTags(prisma, extra.tags) : null;
    const [updated] = await prisma.$transaction([
      prisma.post.update({
        where: { id: linked.id },
        data: {
          title: draft.title,
          excerpt: draft.excerpt || null,
          contentMd: finalMd,
          coverPath,
          contentOrigin: "ai_assisted",
          ...(extra.seoTitle !== undefined ? { seoTitle: extra.seoTitle } : {}),
          ...(extra.seoDescription !== undefined ? { seoDescription: extra.seoDescription } : {}),
          ...(tagLinks
            ? { tags: { deleteMany: {}, ...(tagLinks.length > 0 ? { create: tagLinks } : {}) } }
            : {}),
        },
        select: { id: true, title: true },
      }),
      prisma.topic.update({
        where: { id: topic.id },
        data: {
          composedAt: new Date(),
          ...(topic.status === "collecting" ? { status: "drafted" } : {}),
        },
      }),
    ]);
    return { postId: updated.id, postTitle: updated.title, recomposed: true, coverPath };
  }

  // createPost 自查分类,这里只负责保证「产品评测」行存在(幂等)
  await ensureDefaultCategory();
  const created = await createPost({
    title: draft.title,
    slug: undefined,
    categorySlug: DEFAULT_CATEGORY_SLUG,
    tags: extra.tags && extra.tags.length > 0 ? extra.tags : topicTag(topic.title),
    contentMd: finalMd,
    coverPath: coverPath ?? undefined,
    excerpt: draft.excerpt || undefined,
    seoTitle: extra.seoTitle ?? undefined,
    seoDescription: extra.seoDescription ?? undefined,
    contentOrigin: "ai_assisted",
    isPurchasable: false,
    isLoginRequired: false,
  });
  await prisma.topic.update({
    where: { id: topic.id },
    data: {
      linkedPostId: created.id,
      composedAt: new Date(),
      ...(topic.status === "collecting" ? { status: "drafted" } : {}),
    },
  });
  return { postId: created.id, postTitle: draft.title, recomposed: false, coverPath };
}

/** 近期已发文章标题(防重复选题;get_topic_brief 注入) */
export async function listRecentPublishedTitles(limit = 20): Promise<string[]> {
  const rows = await prisma.post.findMany({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { title: true },
  });
  return rows.map((r) => r.title);
}

/** createPost 的 PostAdminError 归 409(slug 候选尽撞等);其余调用方兜底 500 */
export function isPostAdminError(e: unknown): e is PostAdminError {
  return e instanceof PostAdminError;
}
