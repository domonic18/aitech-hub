/**
 * 贴图域出参投影(M41):BigInt→字符串、Date→ISO 的 API 序列化唯一出口
 * (apiEnvelope 直 JSON.stringify 不容 BigInt)。页面(服务端组件)直用 repo
 * 行 + formatCnDateTime,不经此层(同 topics/dto 口径)。
 */
import type { ContentPin, ContentPinChannel, ContentPinImage } from "@prisma/client";

import type { PinWithMeta } from "./repo";

export interface PinImageDto {
  id: string;
  pinId: string;
  versionId: string | null;
  mediaPath: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
}

export function toPinImageDto(i: ContentPinImage): PinImageDto {
  return {
    id: i.id.toString(),
    pinId: i.pinId.toString(),
    versionId: i.versionId === null ? null : i.versionId.toString(),
    mediaPath: i.mediaPath,
    width: i.width,
    height: i.height,
    sortOrder: i.sortOrder,
  };
}

export interface PinChannelDto {
  id: string;
  pinId: string;
  channel: string;
  status: string;
  mediaId: string | null;
  publishId: string | null;
  attempts: number;
  lastError: string | null;
  syncedAt: string | null;
}

export function toPinChannelDto(c: ContentPinChannel): PinChannelDto {
  return {
    id: c.id.toString(),
    pinId: c.pinId.toString(),
    channel: c.channel,
    status: c.status,
    mediaId: c.mediaId,
    publishId: c.publishId,
    attempts: c.attempts,
    lastError: c.lastError,
    syncedAt: c.syncedAt?.toISOString() ?? null,
  };
}

export interface PinDto {
  id: string;
  title: string;
  content: string;
  topicId: string | null;
  status: string;
  readMoreUrl: string | null;
  cropSpec: string;
  syncedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
}

export function toPinDto(
  p: ContentPin & { _count?: { images: number } },
  imageCountFallback = 0,
): PinDto {
  return {
    id: p.id.toString(),
    title: p.title,
    content: p.content,
    topicId: p.topicId === null ? null : p.topicId.toString(),
    status: p.status,
    readMoreUrl: p.readMoreUrl,
    cropSpec: p.cropSpec,
    syncedAt: p.syncedAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    imageCount: p._count?.images ?? imageCountFallback,
  };
}

/** 详情(带图片序列与渠道留痕) */
export interface PinDetailDto extends PinDto {
  images: PinImageDto[];
  channels: PinChannelDto[];
}

/** 工作台列表行(pin 基础字段 + 首图封面与专题名,soft ref 二次解析产物) */
export interface PinListItemDto extends PinDto {
  coverPath: string | null;
  topicTitle: string | null;
}

export function toPinListItemDto(p: PinWithMeta): PinListItemDto {
  return {
    ...toPinDto(p),
    coverPath: p.coverPath,
    topicTitle: p.topicTitle,
  };
}
