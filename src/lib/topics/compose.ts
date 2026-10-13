/**
 * 专题文档合成(M26 批④,docs/plan/topic-pipeline-plan.md §5):专题定位 +
 * 素材(解读笔记优先,aiNote=null 降级短结论拼装)+ 逐条人工批注 → compose
 * 角色一次 LLM 调用产 {title,excerpt,contentMd} → 落 content_post 草稿
 * (contentOrigin=ai_assisted,默认分类 report「产品评测」缺则幂等补建,标签带
 * 专题标题)→ topic 锚定 linkedPostId+composedAt、collecting→drafted(§10-7)。
 * 同步调用形态(§8:预期 ≤15s,超时受绑定模型 timeoutSec 约束,实测超限再演进入队)。
 * 重合成保护(§10-3):linked 文档 updatedAt > composedAt(或从未合成过的人工
 * 关联)即人工动过 → 路由层 409 需 confirm;linked 已软删 → 弃锚新建。
 */
import { z } from "zod";
import type { Topic, TopicItem } from "@prisma/client";

import { POST_LIMITS } from "../content/post-schema";
import { PostAdminError, createPost } from "../content/posts-admin";
import { AI_PURPOSE_COMPOSE } from "../ai/constants";
import { AiAdminError } from "../ai/errors";
import { chatJsonTask, type ParsedTask } from "../ai/chat-json-task";
import { extractJsonBlock } from "../ai/interpret-result";
import { resolveAiModel } from "../ai/resolver";
import { prisma } from "../db";
import { hydrateItems } from "./repo";

// ── 素材拼装(纯函数,单测钉口径)─────────────────────────────

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
  /** telegram 块:原视频链接与封面图(批①合成重构起注入,供写作引用/CTA);
   * post 块恒 null */
  videoUrl: string | null;
  coverUrl: string | null;
  /** post 块:摘要与正文取样(telegram 块恒 null) */
  excerpt: string | null;
  contentSample: string | null;
}

/** post 正文取样上限(合成只需主题级引用,不整篇灌入) */
export const COMPOSE_POST_SAMPLE_MAX = 2000;

/** aiPoints Json 列读侧归一(白名单字符串;同 feed-view 投影哲学) */
function normalizePoints(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === "string" && p.trim() !== "")
    : [];
}

/**
 * 素材区拼装:笔记优先、降级短结论+要点;人工批注紧随标题(指令对素材的
 * 约束就近可读)。空素材数组返回空串(路由层已先行 400,此处兜底)。
 */
export function buildMaterialSection(blocks: ComposeMaterialBlock[]): string {
  return blocks
    .map((b, i) => {
      const n = i + 1;
      const head =
        b.kind === "telegram"
          ? `【素材${n}·视频】《${b.title}》(博主:${b.blogger ?? "未知"})`
          : `【素材${n}·文章】《${b.title}》`;
      const lines: string[] = [head];
      if (b.note) lines.push(`人工批注:${b.note}`);
      if (b.kind === "telegram") {
        if (b.videoUrl) lines.push(`视频链接:${b.videoUrl}`);
        if (b.coverUrl) lines.push(`封面图:${b.coverUrl}`);
        if (b.aiNote) {
          lines.push(`解读笔记:\n${b.aiNote}`);
        } else {
          // 降级拼装(§4:存量素材合成时自动降级,诚实接受素材深度差异)
          if (b.aiSummary) lines.push(`短结论:${b.aiSummary}`);
          if (b.aiPoints.length > 0)
            lines.push(`要点:\n${b.aiPoints.map((p) => `- ${p}`).join("\n")}`);
        }
      } else {
        if (b.excerpt) lines.push(`摘要:${b.excerpt}`);
        if (b.contentSample) lines.push(`正文节选:\n${b.contentSample}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

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

// ── 输出契约与 prompt ──────────────────────────────────────

/** LLM 输出契约:标题/摘要/正文 markdown(§10-2 公众号口语化 2000±500 字由
 * prompt 约束;契约层只做结构护栏,列帽交给 parse 截断不整条判废) */
export const composeResultSchema = z.object({
  title: z.string().trim().min(1, "标题缺失"),
  excerpt: z.string().trim().default(""),
  contentMd: z.string().trim().min(100, "正文过短"),
});

export type ComposeResult = z.infer<typeof composeResultSchema>;

export function parseComposeResult(raw: string): ParsedTask<ComposeResult> {
  const block = extractJsonBlock(raw);
  if (!block) return { ok: false, error: "输出中未找到 JSON 对象" };
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败:${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    };
  }
  const parsed = composeResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}`.slice(0, 300),
    };
  }
  return {
    ok: true,
    data: {
      title: parsed.data.title.slice(0, POST_LIMITS.title),
      excerpt: parsed.data.excerpt.slice(0, POST_LIMITS.excerpt),
      contentMd: parsed.data.contentMd.slice(0, POST_LIMITS.contentMd),
    },
  };
}

export interface ComposePromptSource {
  topicTitle: string;
  positioning: string | null;
  materialsSection: string;
  /** 近期已发文章标题清单(防重复选题视角;可为空) */
  recentTitles: string[];
}

const OUTPUT_SPEC =
  "输出一个 JSON 对象,字段:title(文章标题,不超过 30 字,像公众号好标题——具体、" +
  "有钩子、信息真实,不标题党不堆砌)、excerpt(摘要,不超过 120 字,一句话说清" +
  "「这篇推荐什么、为什么值得看」)、contentMd(正文全文,markdown 格式,用 ## 二级" +
  "标题分节)。只输出 JSON,不要解释、前后缀或代码围栏。";

/**
 * 产文结构模板(M27 批①合成重构,1276 验收反馈):公众号「博主×视频」推荐短文,
 * 固定结构在代码内钉死——专题定位只做补充指令,不再决定文章形态;短段落+要点化+
 * CTA,治「新闻通稿体/大段文字/无公众号表述」三问题。
 */
const STRUCTURE_SPEC = [
  "正文必须是一篇「博主×视频」推荐短文(公众号种草体),不是新闻通稿。固定结构:",
  "1)开头钩子:不超过 80 字,用视频里最反差或最具体的一个事实/数据直接抓人,不写背景铺垫;",
  "2)## 博主是谁:2~4 句,博主的定位、风格、为什么值得关注(只依据素材,不编造履历与称号);",
  "3)## 视频讲了什么:3~4 个要点,每个要点一个独立小段且不超过 60 字,段首用 **加粗** 点出关键词;严禁把多个要点挤进同一段;",
  "4)## 值得看的理由:1~2 句金句式收束,不得虚构素材之外的评价;",
  "5)## 去看原视频:结尾引导段——自然提及视频标题,并告诉读者:点击公众号文章左下角「阅读原文」进入我们的站点,站内视频卡片可一键跳转原视频;",
  "硬约束:全文 800~1200 字(不含标题与摘要);单个自然段不超过 3 行,多用短句;禁止大段铺陈与罗列式长段;",
  "事实与观点只依据素材给出,不编造;时间/年份表述必须取自素材原文,素材未提就写「近期」,不得自行推断年份;",
  "恰当融合「人工批注」的取舍指令;全部用简体中文;正文总码点控制在 18000 以内。",
].join("\n");

export function buildComposePrompt(src: ComposePromptSource): { system: string; user: string } {
  const recent =
    src.recentTitles.length > 0
      ? `\n——近期已发布文章标题(选题/表述避免重复)——\n${src.recentTitles.map((t) => `- ${t}`).join("\n")}`
      : "";
  return {
    system: `你是头部科技公众号的主编,最擅长把视频内容写成让人愿意点开原视频的推荐短文。初稿经人工编辑定稿后才发布,请把素材中的硬信息(数据、产品名、结论、步骤)完整带到。\n${STRUCTURE_SPEC}\n${OUTPUT_SPEC}`,
    user: [
      `专题:${src.topicTitle}`,
      `创作指令(选材与口吻的补充,固定结构之上生效):${src.positioning?.trim() || "(未填写,按素材自然发挥)"}`,
      "——素材库——",
      src.materialsSection,
      recent,
    ]
      .filter(Boolean)
      .join("\n"),
  };
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

export interface ComposeOutcome {
  postId: bigint;
  postTitle: string;
  /** true=覆盖既有关联文档;false=新建草稿 */
  recomposed: boolean;
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
        contentMd: result.contentMd,
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
    return { postId: updated.id, postTitle: updated.title, recomposed: true };
  }

  // createPost 自查分类,这里只负责保证「产品评测」行存在(幂等)
  await ensureDefaultCategory();
  const created = await createPost({
    title: result.title,
    slug: undefined,
    categorySlug: DEFAULT_CATEGORY_SLUG,
    tags: topicTag(topic.title),
    contentMd: result.contentMd,
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
  return { postId: created.id, postTitle: result.title, recomposed: false };
}

/** createPost 的 PostAdminError 归 409(slug 候选尽撞等);其余调用方兜底 500 */
export function isPostAdminError(e: unknown): e is PostAdminError {
  return e instanceof PostAdminError;
}
