/**
 * 专题文档合成(M26 批④,docs/plan/topic-pipeline-plan.md §5):专题定位 +
 * 素材(解读笔记优先,aiNote=null 降级短结论拼装)+ 逐条人工批注 → compose
 * 角色一次 LLM 调用产 {title,excerpt,contentMd} → 落 content_post 草稿
 * (contentOrigin=ai_assisted,默认分类 report「产品评测」缺则幂等补建,标签带
 * 专题标题)→ topic 锚定 linkedPostId+composedAt、collecting→drafted(§10-7)。
 * M27 批②(1276 验收反馈):首视频封面转存入站内媒体库落 post.coverPath
 * (站点头图 + 公众号大图 + 解锁公众号同步缺封面门),文首确定性注入视频
 * 推荐卡;封面抓取失败降级不阻塞合成(封面可后补,合成结果不回滚)。
 * 同步调用形态(§8:预期 ≤15s,超时受绑定模型 timeoutSec 约束,实测超限再演进入队)。
 * 重合成保护(§10-3):linked 文档 updatedAt > composedAt(或从未合成过的人工
 * 关联)即人工动过 → 路由层 409 需 confirm;linked 已软删 → 弃锚新建。
 * 纯函数(素材拼装/输出契约/prompt/推荐卡)在 ./compose-prompt。
 */
import type { Topic, TopicItem } from "@prisma/client";

import { POST_LIMITS } from "../content/post-schema";
import { PostAdminError, createPost } from "../content/posts-admin";
import { AI_PURPOSE_COMPOSE } from "../ai/constants";
import { AiAdminError } from "../ai/errors";
import { chatJsonTask } from "../ai/chat-json-task";
import { resolveAiModel } from "../ai/resolver";
import { fetchExternalImage } from "../media/fetch-external";
import { uploadMedia } from "../media/service";
import { logger } from "../logger";
import { prisma } from "../db";
import { hydrateItems } from "./repo";
import {
  buildComposePrompt,
  buildMaterialSection,
  buildVideoCard,
  COMPOSE_POST_SAMPLE_MAX,
  normalizePoints,
  parseComposeResult,
  type ComposeMaterialBlock,
} from "./compose-prompt";

/** 重合成保护判定(§10-3 纯函数):有人工关联但从未合成过,或合成后被编辑过 → 需确认 */
export function needsRecomposeConfirm(
  topic: Pick<Topic, "linkedPostId" | "composedAt">,
  linkedPost: { status: string; updatedAt: Date } | null,
): boolean {
  if (!topic.linkedPostId || !linkedPost) return false;
  if (linkedPost.status === "deleted") return false; // 软删弃锚,路由层走新建
  if (topic.composedAt === null) return true; // 人工关联未合成过:覆盖即破坏
  return linkedPost.updatedAt.getTime() > topic.composedAt.getTime();
}

// ── 编排(路由消费)────────────────────────────────────────

/** 正文长输出预算(2000 字 markdown + JSON 包裹,同 interpret-note 放大逻辑) */
const COMPOSE_MAX_TOKENS = 8000;
/** 默认分类(§10-4:分类「产品评测」可改;slug 为站内既有种子,缺则幂等补建) */
const DEFAULT_CATEGORY_SLUG = "report";
const DEFAULT_CATEGORY_NAME = "产品评测";
/** 标签=专题标题(§10-4「标签带专题关键词」v1 最直取实现;超列帽截断) */
function topicTag(title: string): string[] {
  const t = title.trim();
  return t === "" ? [] : [t.slice(0, POST_LIMITS.tag)];
}

/** 近期已发文章标题(防重复选题;数量克制不喧宾夺主) */
export async function listRecentPublishedTitles(limit = 20): Promise<string[]> {
  const rows = await prisma.post.findMany({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { title: true },
  });
  return rows.map((r) => r.title);
}

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
 * 首视频封面转存(批②):外链抓取 + 入站内媒体库 → /uploads 路径。
 * B 站图床有防盗链,站点/公众号直引外链会裂图,转存是双端显示与同步门的地基。
 * 任何失败降级 null 不抛——封面可后补,不回滚整次合成。
 */
async function transferCoverOrNull(coverUrl: string): Promise<string | null> {
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

export interface ComposeOutcome {
  postId: bigint;
  postTitle: string;
  /** true=覆盖既有关联文档;false=新建草稿 */
  recomposed: boolean;
  /** 封面转存结果(null=无视频封面或转存失败降级;人话进返回供 UI 提示) */
  coverPath: string | null;
}

/**
 * 合成主入口(getTopic 素材由调用方传入,避免二次查询):解析/LLM 失败原样
 * 上抛(AiAdminError disabled / AiClientError);落稿失败(PostAdminError 等)
 * 可能留下无锚草稿——重合成会覆盖同一篇(标题派生 slug 撞候选尽抛错),可重试。
 */
export async function composeTopicDraft(
  topic: Topic & { items: TopicItem[] },
): Promise<ComposeOutcome> {
  const model = await resolveAiModel(AI_PURPOSE_COMPOSE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「专题合成(compose)」模型:先到 AI 配置完成任务绑定",
    );
  }

  const materials = await hydrateItems(topic.items);
  // post 素材块需要摘要与正文取样(hydrate 不带长列),按 id 批量补取
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

  const recentTitles = await listRecentPublishedTitles();
  const prompt = buildComposePrompt({
    topicTitle: topic.title,
    positioning: topic.positioning,
    materialsSection: buildMaterialSection(blocks),
    recentTitles,
  });
  const result = await chatJsonTask(
    model,
    parseComposeResult,
    prompt.system,
    prompt.user,
    AI_PURPOSE_COMPOSE,
    { maxTokens: COMPOSE_MAX_TOKENS },
  );

  // 批②:首视频封面转存(降级 null)+ 文首推荐卡注入(确定性,不依赖 LLM)
  const primaryCoverUrl = blocks.find((b) => b.kind === "telegram")?.coverUrl ?? null;
  const coverPath = primaryCoverUrl ? await transferCoverOrNull(primaryCoverUrl) : null;
  const cardMd = buildVideoCard(blocks);
  const finalMd = cardMd ? `${cardMd}\n\n${result.contentMd}` : result.contentMd;

  const linkedPostId =
    topic.linkedPostId !== null
      ? await prisma.post.findUnique({
          where: { id: topic.linkedPostId },
          select: { id: true, status: true },
        })
      : null;
  const recompose = linkedPostId !== null && linkedPostId.status !== "deleted";

  if (recompose && linkedPostId) {
    const updated = await prisma.post.update({
      where: { id: linkedPostId.id },
      data: {
        title: result.title,
        excerpt: result.excerpt || null,
        contentMd: finalMd,
        coverPath,
        contentOrigin: "ai_assisted",
      },
      select: { id: true, title: true },
    });
    await prisma.topic.update({
      where: { id: topic.id },
      data: {
        composedAt: new Date(),
        ...(topic.status === "collecting" ? { status: "drafted" } : {}),
      },
    });
    return { postId: updated.id, postTitle: updated.title, recomposed: true, coverPath };
  }

  // createPost 自查分类,这里只负责保证「产品评测」行存在(幂等)
  await ensureDefaultCategory();
  const created = await createPost({
    title: result.title,
    slug: undefined,
    categorySlug: DEFAULT_CATEGORY_SLUG,
    tags: topicTag(topic.title),
    contentMd: finalMd,
    coverPath: coverPath ?? undefined,
    excerpt: result.excerpt || undefined,
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
  return { postId: created.id, postTitle: result.title, recomposed: false, coverPath };
}

/** createPost 的 PostAdminError 归 409(slug 候选尽撞等);其余调用方兜底 500 */
export function isPostAdminError(e: unknown): e is PostAdminError {
  return e instanceof PostAdminError;
}
