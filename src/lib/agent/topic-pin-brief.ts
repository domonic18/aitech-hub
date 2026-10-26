/**
 * brief 贴图区(M42 批③;自 topic-tools 拆出防超 350 行纪律):一份载荷同时服务
 * 长文与贴图两条分支——贴图配置(独立列,与长文配置互不派生)、本创作既有贴图
 * (防重复产出/确认哪几张已在)、参照候选(样例图→图库→视频封面→文章配图→本创作
 * 贴图,仅站内 uploads)、已挂素材键(模型挂载前自查,避免重复挂)。
 */
import { prisma } from "../db";
import type { VideoCoverAsset, ComposeMaterialBlock } from "../topics/compose";
import type { TopicWithItems } from "../topics/repo";
import { resolveTopicReferences } from "../topics/references";
import {
  PIN_ASPECT_LABEL,
  PIN_CROP_LABEL,
  parsePinWritingText,
} from "../topics/writing-pin-config";

/** 既有贴图最多带出条数(近期优先;够模型判断是否已出过即可) */
const EXISTING_PINS_MAX = 10;

export interface PinBriefParts {
  pin_config: {
    count: number;
    aspect: string;
    crop: string;
    style: string;
    /** 人工指定的参照图路径(null = 未指定,按 reference_candidates 优先级自选) */
    reference: string | null;
    supplement: string;
    custom: boolean;
    /** 人话版一行摘要(弱模型直接照读,不必再解结构) */
    note: string;
  };
  existing_pins: {
    id: string;
    title: string;
    status: string;
    images: number;
    admin_url: string;
  }[];
  reference_candidates: { source: string; media_path: string; label: string }[];
  /** 已挂素材键(`telegram:<id>` / `post:<id>`),挂载前自查 */
  mounted_keys: string[];
}

export async function buildPinBrief(
  topic: TopicWithItems,
  opts: { blocks: ComposeMaterialBlock[]; coverAssets: VideoCoverAsset[] },
): Promise<PinBriefParts> {
  const parsed = parsePinWritingText(topic.pinPositioning);
  const [pins, references] = await Promise.all([
    prisma.contentPin.findMany({
      where: { topicId: topic.id },
      orderBy: { updatedAt: "desc" },
      take: EXISTING_PINS_MAX,
      select: {
        id: true,
        title: true,
        status: true,
        _count: { select: { images: true } },
      },
    }),
    resolveTopicReferences(topic, { blocks: opts.blocks, coverAssets: opts.coverAssets }),
  ]);
  const sel = parsed.selection;
  return {
    pin_config: {
      count: sel.count,
      aspect: sel.aspect,
      crop: sel.crop,
      style: sel.style,
      reference: sel.reference || null,
      supplement: parsed.supplement,
      custom: parsed.custom,
      note:
        `出 ${sel.count} 张,比例 ${PIN_ASPECT_LABEL[sel.aspect] ?? sel.aspect},` +
        `首图裁剪 ${PIN_CROP_LABEL[sel.crop] ?? sel.crop}` +
        (sel.style ? `;画面风格:${sel.style}` : ";画面风格交给参照图承载,不写配色词") +
        (sel.reference
          ? `;人工指定参照图:${sel.reference}`
          : ";未指定参照图,按 reference_candidates 优先级自选一张"),
    },
    existing_pins: pins.map((p) => ({
      id: p.id.toString(),
      title: p.title,
      status: p.status,
      images: p._count.images,
      admin_url: `/admin/pins/${p.id.toString()}`,
    })),
    reference_candidates: references.map((r) => ({
      source: r.source,
      media_path: r.mediaPath,
      label: r.label,
    })),
    mounted_keys: topic.items.map((i) => `${i.itemType}:${i.itemId.toString()}`),
  };
}
