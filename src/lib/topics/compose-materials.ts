/**
 * 素材块拼装(M47 批D 自 compose.ts 切出,拆文件守 350 行线;原 compose-prompt
 * 纯函数段,M27 批⑤并档):hydrate 取数 + post 摘要/正文取样 → 结构化素材块,
 * get_topic_brief 工具消费;含文首推荐卡(确定性注入)。兼容出口住 compose.ts。
 */
import type { Topic, TopicItem } from "@prisma/client";

import { prisma } from "../db";
import { hydrateItems } from "./materials";

/** 合成素材块(hydrateItems 同源取数,post 块额外带摘要与正文取样) */
export interface ComposeMaterialBlock {
  kind: "telegram" | "post";
  /** telegram 块分型(M42:文本素材也是一等底料);post 块恒 null */
  mediaType: "video" | "text" | null;
  title: string;
  blogger: string | null;
  /** 人工批注(合成取舍指令,原样注入) */
  note: string | null;
  /** 解读笔记(§4:优先;null=存量/降级轮次 → 降级拼装) */
  aiNote: string | null;
  aiSummary: string | null;
  aiPoints: string[];
  /** 电报原文 1-3 句(文本素材的主底料;视频为辅助) */
  summary: string | null;
  /** 解读主题与关键词(视频素材才有,供选题关联) */
  aiTopic: string | null;
  keywords: string[];
  /** telegram 视频块:原视频链接与封面图(供写作引用/CTA);文本/post 块恒 null */
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
      const isVideo = m.telegram.mediaType === "video";
      blocks.push({
        kind: "telegram",
        mediaType: isVideo ? "video" : "text",
        title: m.telegram.title ?? "(无标题)",
        blogger: m.telegram.videoBlogger,
        note: item.note,
        aiNote: m.telegram.aiNote,
        aiSummary: m.telegram.aiSummary,
        aiPoints: normalizePoints(m.telegram.aiPoints),
        summary: m.telegram.summary,
        aiTopic: m.telegram.aiTopic,
        keywords: normalizePoints(m.telegram.aiKeywords),
        videoUrl: isVideo ? m.telegram.url : null,
        coverUrl: isVideo ? (m.telegram.videoCoverUrl ?? null) : null,
        excerpt: null,
        contentSample: null,
      });
    } else if (item.itemType === "post" && m.post) {
      const detail = postMap.get(m.post.id);
      blocks.push({
        kind: "post",
        mediaType: null,
        title: detail?.title ?? m.post.title ?? "(无标题)",
        blogger: null,
        note: item.note,
        aiNote: null,
        aiSummary: null,
        aiPoints: [],
        summary: null,
        aiTopic: null,
        keywords: [],
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
 * 文首推荐卡(M27 批②建,批⑥升级带图):确定性注入不依赖模型,置正文最顶。
 * 批⑥:卡内嵌首视频自己的封面(图上文下两段式 blockquote;双端渲染器对块内
 * md 图片语法原生支持,公众号侧经 transload 转 mmbiz + image 规则内联样式),
 * 图必须是所推荐视频自己的封面(语义锚定),转存失败/无视频素材降级纯文字卡。
 * 2026-10-20 验收反馈问题四:正文渠道中性化——「阅读原文」类公众号导流话术
 * 不再写进正文(文章要分发多渠道),站内导流由分发层按渠道追加尾注
 * (distribute/channel-tails),视频直达链接由写作指南要求正文自带 video_url。
 */
export function buildVideoCard(
  blocks: ComposeMaterialBlock[],
  cardCoverPath: string | null,
): string | null {
  // M42:仅视频素材产生推荐卡(电报文本素材不是视频,不造假推荐)
  const v = blocks.find((b) => b.kind === "telegram" && b.mediaType === "video");
  if (!v) return null;
  const imageLine = cardCoverPath ? `> ![${v.title}](${cardCoverPath})\n>\n` : "";
  return imageLine + `> 📺 本文推荐视频:《${v.title}》· UP主:${v.blogger ?? "未知"}`;
}
