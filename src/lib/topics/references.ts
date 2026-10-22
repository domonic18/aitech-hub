/**
 * 创作参照图解析(M42 批②):给贴图/配图生成提供「像什么」的站内视觉锚点,
 * 让 AI 出图不是凭空发挥。优先级 sample_image(人工指定风格)→ video_cover
 * (素材视频封面)→ post_image(挂载文章正文配图)→ pin_image(本创作已有
 * 贴图,视觉延续);去重、仅收 uploads 站内路径、上限 10。
 * 视频封面须由调用方先行转存(coverAssets 与 blocks 视频子序列同序),本模块
 * 不发起外链下载——工具调用里不藏网络阻塞;没转存就跳过该层,不抛错。
 */
import type { Topic } from "@prisma/client";

import { prisma } from "../db";
import { extractMediaRefs, isUploadsPath } from "../media/refs";
import type { ComposeMaterialBlock, VideoCoverAsset } from "./compose";
import type { ReferenceSource } from "./reference-labels";

/** 来源标签住零依赖模块(客户端组件共用),此处再导出保持既有取数口径 */
export { REFERENCE_SOURCE_LABEL, type ReferenceSource } from "./reference-labels";

/** 参照图上限(贴图生成只接受单张参照,列表供人工/agent 选择) */
export const REFERENCE_LIMIT_MAX = 10;
/** 单篇文章最多取几张配图(避免一篇占满名额) */
const POST_IMAGES_PER_POST = 2;
/** 本创作最多看几张贴图 */
const PIN_SCAN_MAX = 3;

export interface ReferenceCandidate {
  source: ReferenceSource;
  mediaPath: string;
  label: string;
}

export interface ResolveTopicReferencesOptions {
  /** 已拼装素材块(取视频子序列);缺省不看视频封面层 */
  blocks?: ComposeMaterialBlock[] | undefined;
  /** 已转存封面(transferVideoCovers 产物),与 blocks 视频子序列同序 */
  coverAssets?: VideoCoverAsset[] | undefined;
  limit?: number | undefined;
}

export async function resolveTopicReferences(
  topic: Pick<Topic, "id" | "sampleImageId">,
  opts: ResolveTopicReferencesOptions = {},
): Promise<ReferenceCandidate[]> {
  const limit = Math.min(REFERENCE_LIMIT_MAX, Math.max(1, opts.limit ?? REFERENCE_LIMIT_MAX));
  const out: ReferenceCandidate[] = [];
  const seen = new Set<string>();
  const push = (source: ReferenceSource, mediaPath: string | null, label: string): void => {
    if (out.length >= limit || mediaPath === null) return;
    if (!isUploadsPath(mediaPath) || seen.has(mediaPath)) return;
    seen.add(mediaPath);
    out.push({ source, mediaPath, label });
  };

  // ① 样例参照图(人工指定的风格锚)
  if (topic.sampleImageId !== null) {
    const sample = await prisma.writingSampleImage.findUnique({
      where: { id: topic.sampleImageId },
      select: { name: true, mediaPath: true },
    });
    if (sample) push("sample_image", sample.mediaPath, `样例参照图《${sample.name}》`);
  }

  // ② 素材视频封面(已转存站内;与 blocks 视频子序列同序对齐)
  if (opts.blocks && opts.coverAssets) {
    const videos = opts.blocks.filter((b) => b.kind === "telegram" && b.mediaType === "video");
    videos.forEach((b, i) => {
      push("video_cover", opts.coverAssets?.[i]?.coverPath ?? null, `视频《${b.title}》封面`);
    });
  }

  // ③ 挂载文章的正文配图(含封面;每篇取前 2 张)
  const postItems = await prisma.topicItem.findMany({
    where: { topicId: topic.id, itemType: "post" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { itemId: true },
  });
  if (postItems.length > 0) {
    const posts = await prisma.post.findMany({
      where: { id: { in: postItems.map((i) => i.itemId) } },
      select: {
        id: true,
        title: true,
        contentMd: true,
        contentHtml: true,
        coverPath: true,
      },
    });
    const postMap = new Map(posts.map((p) => [p.id, p]));
    for (const item of postItems) {
      const post = postMap.get(item.itemId);
      if (!post) continue; // 源已软删/不存在:静默跳过(软引用容错)
      const refs = extractMediaRefs({
        contentMd: post.contentMd,
        contentHtml: post.contentHtml,
        coverPath: post.coverPath,
      });
      refs.slice(0, POST_IMAGES_PER_POST).forEach((path, i) => {
        push("post_image", path, `文章《${post.title}》配图${i + 1}`);
      });
    }
  }

  // ④ 本创作已有贴图(AI 直出的视觉延续,取首图)
  const pins = await prisma.contentPin.findMany({
    where: { topicId: topic.id },
    orderBy: { updatedAt: "desc" },
    take: PIN_SCAN_MAX,
    select: {
      title: true,
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { mediaPath: true } },
    },
  });
  for (const pin of pins) {
    push("pin_image", pin.images[0]?.mediaPath ?? null, `贴图《${pin.title}》`);
  }

  return out;
}
