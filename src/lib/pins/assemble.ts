/**
 * 贴图落库组装(M42 批③建,agent save_topic_pin 的执行面;M72 瘦身 B4 后
 * 站内 agent 写工具下线,本模块成为 MCP `create_pin` 的唯一执行面):一次事务建
 * content_pin + content_pin_image(按入参顺序落 sortOrder,首图即封面)+ 采纳
 * 参照 reference_media_path。
 * 硬闸在 schema 之外再卡一层(工具入参经模型,不能只信 Zod):标题/轻文字
 * 按码点计数([...s].length,公众号契约),图片 1..PIN_IMAGES_MAX、只收 uploads
 * 站内路径、重复路径拒(同图重复挂无意义且会顶掉封面位)。
 * 阅读原文自动化(2026-10-24 验收反馈,生产全流程免手动):缺省回填本贴前台
 * 自链(未发布先占位,站点发布后自然可达;微信同步只读库值,故必须持久化)。
 * create-only:既有贴图编辑仍走组装台(repo.updatePin + 图片序列接口)。
 */
import type { ContentPin } from "@prisma/client";

import { asciiSlugFromTitle, pinPath } from "../content/pin-path";
import { isUploadsPath } from "../media/refs";
import { prisma } from "../db";
import { absoluteUrl } from "../seo/site";

import { PIN_CONTENT_MAX, PIN_IMAGES_MAX, PIN_TITLE_MAX, type PinCropSpec } from "./constants";
import { PinError } from "./repo";

export interface CreatePinWithImagesInput {
  title: string;
  content?: string;
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
 * 单事务落贴图。返回含 id 的 pin 行(id 用于组装台/前台链接)。
 */
export async function createPinWithImages(input: CreatePinWithImagesInput): Promise<ContentPin> {
  assertPinAssembleInput(input);
  const title = input.title.trim();
  const images = input.images;
  return prisma.$transaction(async (tx) => {
    const pin = await tx.contentPin.create({
      data: {
        title,
        content: input.content ?? "",
        readMoreUrl: input.readMoreUrl ?? null,
        cropSpec: input.cropSpec ?? "1_1",
        referenceMediaPath: input.referenceMediaPath ?? null,
      },
    });
    // 阅读原文缺省回填本贴自链:自链含 id,只能在 create 后补写(同事务内,
    // 失败整体回滚);显式传入则尊重传入值不覆盖
    let result = pin;
    if (input.readMoreUrl == null) {
      result = await tx.contentPin.update({
        where: { id: pin.id },
        data: { readMoreUrl: absoluteUrl(pinPath(pin.id, asciiSlugFromTitle(title))) },
      });
    }
    await tx.contentPinImage.createMany({
      data: images.map((mediaPath, i) => ({
        pinId: pin.id,
        versionId: null,
        mediaPath,
        sortOrder: i,
      })),
    });
    return result;
  });
}
