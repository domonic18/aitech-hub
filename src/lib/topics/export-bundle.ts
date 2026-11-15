/**
 * 创作素材包导出(D5 创作中心降级后的唯一出口,2026-11-15):
 * 创作职责迁到线下 Claude Code 后,站内创作中心保留「素材台账 + 写作配置 +
 * 导出给线下」——本模块就是那份「导出给线下」的形状。
 *
 * 为什么不是 agent 工具:Topic 是站内创作项目状态机,D6 裁定不向 PAT 开放;
 * 导出走会话 HTTP(编辑器交互面),线下拿到素材包后自己起稿。
 *
 * 指南真相源:仓库 `skills/writing/*.md`(D8/D7),不是站内 agent_skill 表——
 * 线上与线下读同一份,改指南不发版。绑定键命中即随包带全文,未命中则带全量
 * 清单让线下自行选。
 */
import { prisma } from "@/lib/db";
import { listWritingSkills, readWritingSkill } from "@/lib/skills/writing-skills";
import { listRecentPublishedTitles } from "@/lib/topics/compose";
import { hydrateItems } from "@/lib/topics/materials";
import { getTopic } from "@/lib/topics/repo";

/** post 正文取样上限(与合成底料同口径:主题级引用,不整篇灌入) */
const POST_SAMPLE_MAX = 2000;

export interface TopicExportMaterial {
  kind: "telegram" | "post";
  mediaType: "video" | "text" | null;
  title: string;
  /** 电报原文链接(可溯源;post 块给站内 slug) */
  source: string | null;
  blogger: string | null;
  /** 人工批注(取舍指令,原样带出) */
  note: string | null;
  videoUrl: string | null;
  coverUrl: string | null;
  aiTopic: string | null;
  keywords: string[];
  /** 解读笔记全文(优先);无笔记则给摘要 + 要点 */
  noteMd: string | null;
  summary: string | null;
  points: string[];
  /** post 块:摘要与正文取样 */
  excerpt: string | null;
  contentSample: string | null;
}

export interface TopicExportBundle {
  exportedAt: string;
  topic: {
    id: string;
    title: string;
    /** 长文创作配置(四维条款文本) */
    positioning: string | null;
    /** 贴图创作配置(张数/比例/裁剪/风格) */
    pinPositioning: string | null;
    outputType: string;
    status: string;
    /** 绑定的写作指南 key */
    skillKey: string | null;
  };
  /** 绑定指南全文(命中绑定键时) */
  skill: { key: string; name: string; scenario: string; version: string; guideMd: string } | null;
  /** 全部指南清单(未绑定或绑定缺失时,供线下自行选) */
  skills: { key: string; name: string; scenario: string; version: string }[];
  materials: TopicExportMaterial[];
  linkedPost: { id: string; title: string; status: string; adminUrl: string } | null;
  /** 近期已发标题(线下选题防重复) */
  recentPublishedTitles: string[];
  /** 给线下助手的工作说明(随包走,避免口径散在多处) */
  note: string;
}

/**
 * 拼装素材包(会话 HTTP 消费方;导出与站内合成读同一批素材,不另开口径)。
 */
export async function buildTopicExportBundle(topicId: bigint): Promise<TopicExportBundle> {
  const topic = await getTopic(topicId);
  const hydrated = await hydrateItems(topic.items);
  const postIds = topic.items.filter((i) => i.itemType === "post").map((i) => i.itemId);
  const postRows = postIds.length
    ? await prisma.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, title: true, slug: true, status: true, excerpt: true, contentMd: true },
      })
    : [];
  const postMap = new Map(postRows.map((r) => [r.id, r]));

  const materials: TopicExportMaterial[] = [];
  for (const item of topic.items) {
    const m = hydrated.get(item.id);
    if (!m) continue;
    if (item.itemType === "telegram" && m.telegram) {
      const tg = m.telegram;
      const isVideo = tg.mediaType === "video";
      materials.push({
        kind: "telegram",
        mediaType: isVideo ? "video" : "text",
        title: tg.title ?? "(无标题)",
        source: tg.url ?? null,
        blogger: tg.videoBlogger ?? null,
        note: item.note ?? null,
        videoUrl: isVideo ? tg.url : null,
        coverUrl: isVideo ? (tg.videoCoverUrl ?? null) : null,
        aiTopic: tg.aiTopic ?? null,
        keywords: Array.isArray(tg.aiKeywords) ? tg.aiKeywords : [],
        noteMd: tg.aiNote ?? null,
        summary: tg.aiSummary ?? tg.summary ?? null,
        points: Array.isArray(tg.aiPoints) ? tg.aiPoints.filter((p) => typeof p === "string") : [],
        excerpt: null,
        contentSample: null,
      });
      continue;
    }
    if (item.itemType === "post") {
      const post = postMap.get(item.itemId);
      if (!post) continue;
      materials.push({
        kind: "post",
        mediaType: null,
        title: post.title,
        source: post.slug ? `/post/${post.id}-${post.slug}` : null,
        blogger: null,
        note: item.note ?? null,
        videoUrl: null,
        coverUrl: null,
        aiTopic: null,
        keywords: [],
        noteMd: null,
        summary: null,
        points: [],
        excerpt: post.excerpt ?? null,
        contentSample: (post.contentMd ?? "").slice(0, POST_SAMPLE_MAX),
      });
    }
  }

  const bound = topic.skillKey ? readWritingSkill(topic.skillKey) : null;
  const linkedId = topic.linkedPostId;
  const linkedRow =
    linkedId !== null
      ? await prisma.post.findUnique({
          where: { id: linkedId },
          select: { id: true, title: true, status: true },
        })
      : null;

  return {
    exportedAt: new Date().toISOString(),
    topic: {
      id: topic.id.toString(),
      title: topic.title,
      positioning: topic.positioning,
      pinPositioning: topic.pinPositioning,
      outputType: topic.outputType,
      status: topic.status,
      skillKey: topic.skillKey,
    },
    skill: bound
      ? {
          key: bound.key,
          name: bound.name,
          scenario: bound.scenario,
          version: bound.version,
          guideMd: bound.guideMd,
        }
      : null,
    skills: listWritingSkills().map((s) => ({
      key: s.key,
      name: s.name,
      scenario: s.scenario,
      version: s.version,
    })),
    materials,
    linkedPost:
      linkedId !== null && linkedRow
        ? {
            id: linkedId.toString(),
            title: linkedRow.title,
            status: linkedRow.status,
            adminUrl: `/admin/posts/${linkedId.toString()}`,
          }
        : null,
    recentPublishedTitles: await listRecentPublishedTitles(),
    note:
      "本素材包由站内创作中心导出,供线下 Claude Code 写作助手取料。动笔前先读 skill 指南全文" +
      "(未绑定 skill 时按 skills 清单自选一份);出稿后按站内约定上传落草稿(整包上传走" +
      "POST /api/posts/bundle,批量走 POST /api/posts/bundles),发布仍由站长在后台人工执行。",
  };
}
