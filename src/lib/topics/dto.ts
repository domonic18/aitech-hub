/**
 * 专题域出参投影(M26 批③):BigInt→字符串、Date→ISO 的 API 序列化唯一出口
 * (apiEnvelope 直 JSON.stringify 不容 BigInt)。页面(服务端组件)直用 repo
 * 行 + formatCnDateTime,不经此层。
 */
import type { Topic, TopicItem } from "@prisma/client";

import type { TopicItemMaterial } from "./materials";

export interface TopicDto {
  id: string;
  title: string;
  positioning: string | null;
  pinPositioning: string | null;
  outputType: string;
  skillKey: string | null;
  status: string;
  linkedPostId: string | null;
  sampleImageId: string | null;
  composedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

export function toTopicDto(
  t: Topic & { _count?: { items: number } },
  itemCountFallback = 0,
): TopicDto {
  return {
    id: t.id.toString(),
    title: t.title,
    positioning: t.positioning,
    pinPositioning: t.pinPositioning,
    outputType: t.outputType,
    skillKey: t.skillKey,
    status: t.status,
    linkedPostId: t.linkedPostId === null ? null : t.linkedPostId.toString(),
    sampleImageId: t.sampleImageId === null ? null : t.sampleImageId.toString(),
    composedAt: t.composedAt?.toISOString() ?? null,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    itemCount: t._count?.items ?? itemCountFallback,
  };
}

export interface TopicItemDto {
  id: string;
  itemType: "telegram" | "post";
  itemId: string;
  note: string | null;
  sortOrder: number;
  createdAt: string;
  telegram: {
    id: string;
    title: string | null;
    /** video / text(M42:电报文本素材) */
    mediaType: string;
    /** 原文 1-3 句(文本素材的主底料) */
    summary: string;
    videoBlogger: string | null;
    url: string;
    videoCoverUrl: string | null;
    aiSummary: string | null;
    aiPoints: unknown;
    aiNote: string | null;
    aiTopic: string | null;
    aiKeywords: unknown;
  } | null;
  post: { id: string; title: string; status: string } | null;
}

export function toItemDto(item: TopicItem, material?: TopicItemMaterial | undefined): TopicItemDto {
  return {
    id: item.id.toString(),
    itemType: item.itemType as "telegram" | "post",
    itemId: item.itemId.toString(),
    note: item.note,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
    telegram: material?.telegram
      ? { ...material.telegram, id: material.telegram.id.toString() }
      : null,
    post: material?.post ? { ...material.post, id: material.post.id.toString() } : null,
  };
}
