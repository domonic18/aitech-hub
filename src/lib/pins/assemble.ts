/**
 * 贴图落库组装(M42 批③,agent save_topic_pin 的执行面):一次事务建
 * content_pin + content_pin_image(按入参顺序落 sortOrder,首图即封面)+ 采纳
 * 参照 reference_media_path + 创作状态推进(collecting→drafted)。
 * 硬闸在 schema 之外再卡一层(工具入参经模型,不能只信 Zod):标题/轻文字
 * 按码点计数([...s].length,公众号契约),图片 1..PIN_IMAGES_MAX、只收 uploads
 * 站内路径、重复路径拒(同图重复挂无意义且会顶掉封面位)。
 * create-only:既有贴图编辑仍走组装台(repo.updatePin + 图片序列接口)。
 */
import type { ContentPin } from "@prisma/client";

import { isUploadsPath } from "../media/refs";
import { prisma } from "../db";

import { PIN_CONTENT_MAX, PIN_IMAGES_MAX, PIN_TITLE_MAX, type PinCropSpec } from "./constants";
import { PinError } from "./repo";

export interface CreatePinWithImagesInput {
  title: string;
  content?: string;
  /** 所属创作(soft ref;传入则校验存在并推进 collecting→drafted) */
  topicId?: bigint | null;
  /** 有序图片(站内 uploads 路径,首图为封面,1..20 张) */
  images: string[];
  /** 本次出图采纳的风格参照(站内 uploads,读侧缺行降级为无参照) */
  referenceMediaPath?: string | null;
  cropSpec?: PinCropSpec;
  readMoreUrl?: string | null;
}

function codePoints(s: string): number {
  return [...s].length;
}

/** 入参硬校验(纯函数,单测锚点);不过即人话 PinError */
export function assertPinAssembleInput(input: CreatePinWithImagesInput): void {
  const title = input.title.trim();
  if (title === "") throw new PinError("invalid_input", "标题必填");
  if (codePoints(title) > PIN_TITLE_MAX) {
    throw new PinError("invalid_input", `标题最长 ${PIN_TITLE_MAX} 字(公众号上限)`);
  }
  if (codePoints(input.content ?? "") > PIN_CONTENT_MAX) {
    throw new PinError("invalid_input", `轻文字最长 ${PIN_CONTENT_MAX} 字`);
  }
  const images = input.images ?? [];
  if (images.length === 0) throw new PinError("invalid_input", "贴图至少需要 1 张图");
  if (images.length > PIN_IMAGES_MAX) {
    throw new PinError("invalid_input", `图片最多 ${PIN_IMAGES_MAX} 张(公众号上限)`);
  }
  const bad = images.filter((p) => !isUploadsPath(p));
  if (bad.length > 0) {
    throw new PinError("invalid_input", `图片须为站内上传路径:${bad.join(", ")}`);
  }
  if (new Set(images).size !== images.length) {
    throw new PinError("invalid_input", "图片路径有重复,同一张图不能挂两次");
  }
  if (input.referenceMediaPath && !isUploadsPath(input.referenceMediaPath)) {
    throw new PinError("invalid_input", "参照图须为站内上传路径");
  }
}

/**
 * 单事务落贴图;topic 不存在 → not_found(不建悬空 soft ref)。
 * 返回含 id 的 pin 行(id 用于组装台/前台链接)。
 */
export async function createPinWithImages(input: CreatePinWithImagesInput): Promise<ContentPin> {
  assertPinAssembleInput(input);
  const title = input.title.trim();
  const images = input.images;
  return prisma.$transaction(async (tx) => {
    if (input.topicId != null) {
      const topic = await tx.topic.findUnique({
        where: { id: input.topicId },
        select: { id: true },
      });
      if (!topic) throw new PinError("not_found", "创作项目不存在");
    }
    const pin = await tx.contentPin.create({
      data: {
        title,
        content: input.content ?? "",
        topicId: input.topicId ?? null,
        readMoreUrl: input.readMoreUrl ?? null,
        cropSpec: input.cropSpec ?? "1_1",
        referenceMediaPath: input.referenceMediaPath ?? null,
      },
    });
    await tx.contentPinImage.createMany({
      data: images.map((mediaPath, i) => ({
        pinId: pin.id,
        versionId: null,
        mediaPath,
        sortOrder: i,
      })),
    });
    // 状态推进只对「收集中」生效(已出稿/已发布的创作不因新增贴图回退)
    if (input.topicId != null) {
      await tx.topic.updateMany({
        where: { id: input.topicId, status: "collecting" },
        data: { status: "drafted" },
      });
    }
    return pin;
  });
}
