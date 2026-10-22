/**
 * 配图工坊·交互编辑执行核心(M40 批 B,arch/05 §4.7):三条编辑回路统一
 * 「bbox+指令 → Seedream 交互编辑 → 新整图」——文字修改(改字必选,M40 立项
 * 原始动机)/消除笔/自由重绘兜底。spike 实证契约(2026-10-22):POST
 * {baseUrl}/images/generations,body {model, image(整图 data URL), prompt(
 * 内嵌 <bbox>x1 y1 x2 y2</bbox>(normalized 0-999,左上原点)+编辑指令),
 * size: "2K"(模型保持输入图尺寸档),response_format: "b64_json"} → ~15s
 * 返 1 张新整图。走 generateImages 复用参照图通道(image 参数)与计费/转存
 * 纪律;同步执行 ~15s 在请求内等待(同 generate_illustration 口径,agent 工具
 * 流本就长驻)。bbox+指令只是机制参数,指令文案由调用面(EditPanel)给,
 * 三回路模板在此单源。
 */
import path from "node:path";

import { logger } from "../logger";
import { MEDIA_MIME_BY_EXT, mediaStorage, uploadsUrlToRel } from "../media/storage";
import { uploadMedia } from "../media/service";

import { AI_PURPOSE_ILLUSTRATE } from "./constants";
import { AiAdminError, AiClientError } from "./errors";
import { decodeImageB64, downloadImage, generateImages, sniffImageMime } from "./image-client";
import { resolveAiModel } from "./resolver";
import { recordAiUsage } from "./usage-log";

/** 编辑回路枚举:文字修改/消除笔/自由重绘(plan M40 行三回路) */
export const ILLUSTRATION_EDIT_MODES = ["text", "erase", "redraw"] as const;
export type IllustrationEditMode = (typeof ILLUSTRATION_EDIT_MODES)[number];

/** 编辑数据 URL 源图帽(同参照图 6MB;工坊锚定站内出图) */
const SOURCE_MAX_BYTES = 6 * 1024 * 1024;

export interface EditIllustrationInput {
  /** 编辑基准整图(站内媒体路径,通常是当前版本 mediaPath) */
  imagePath: string;
  mode: IllustrationEditMode;
  /** normalized bbox "x1 y1 x2 y2"(0-999;三回路统一 bbox 契约) */
  bbox: string;
  /** 编辑指令:text=新文案;erase=可空(消除默认模板);redraw=重绘内容描述 */
  instruction?: string;
}

/** 三回路 prompt 模板单源(spike 实测文案原样;EditPanel 只传参不拼 prompt) */
export function buildEditPrompt(
  mode: IllustrationEditMode,
  bbox: string,
  instruction?: string,
): string {
  const region = `<bbox>${bbox}</bbox>`;
  if (mode === "text") {
    return `将图1中 ${region} 区域内的文字修改为:${(instruction ?? "").trim()}`;
  }
  if (mode === "erase") {
    const extra = (instruction ?? "").trim();
    return `将图1中 ${region} 区域内的元素完全消除,背景自然无缝补全${extra ? `:${extra}` : ""}`;
  }
  return `将图1中 ${region} 区域重绘:${(instruction ?? "").trim()}`;
}

async function loadImageDataUrl(mediaPath: string): Promise<string> {
  const rel = uploadsUrlToRel(mediaPath);
  if (!rel) throw new AiAdminError("invalid", `图片路径不合法(仅支持站内媒体路径):${mediaPath}`);
  const bytes = await mediaStorage.get(rel);
  if (!bytes || bytes.length === 0)
    throw new AiAdminError("invalid", "图片文件读取失败(可能已被删除)");
  if (bytes.length > SOURCE_MAX_BYTES) throw new AiAdminError("invalid", "图片超过 6MB 体积帽");
  const mime = MEDIA_MIME_BY_EXT[path.extname(rel).toLowerCase()] ?? "";
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") {
    throw new AiAdminError("invalid", "图片格式不支持(仅 png/jpeg/webp)");
  }
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** 交互编辑:返回候选整图站内路径(预览态确认制——调用面确认后才落版本链,
 * 候选图本身已入媒体库,弃用即闲置不回收,同 generate_illustration 未选用口径) */
export async function editIllustration(
  input: EditIllustrationInput,
): Promise<{ imagePath: string }> {
  const model = await resolveAiModel(AI_PURPOSE_ILLUSTRATE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「插图配图(illustrate)」模型:先到 AI 配置完成任务绑定(需 OpenAI images/generations 兼容端点)",
    );
  }
  const image = await loadImageDataUrl(input.imagePath);
  const prompt = buildEditPrompt(input.mode, input.bbox, input.instruction);
  const startedAt = Date.now();
  let images;
  try {
    images = await generateImages({
      protocol: model.protocol,
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      apiKey: model.apiKey,
      prompt,
      n: 1,
      size: "2K",
      timeoutSec: model.timeoutSec,
      extraParams: model.extraParams,
      image,
    });
  } catch (e) {
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw e;
  }
  if (images.length === 0) {
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw new AiClientError("business", "编辑返回了空结果(契约漂移,检查供应商与模型 ID)");
  }
  await recordAiUsage({
    role: AI_PURPOSE_ILLUSTRATE,
    modelId: model.id,
    modelKey: model.modelId,
    durationMs: Date.now() - startedAt,
    status: model.source === "backup" ? "degraded" : "ok",
  });
  const img = images[0];
  const bytes =
    "b64" in img
      ? decodeImageB64(img.b64)
      : await downloadImage(img.url, model.timeoutSec, {
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
        });
  const mime = sniffImageMime(bytes);
  const saved = await uploadMedia({
    data: bytes,
    mime,
    filename: `illu-edit-${Date.now().toString(36)}.${mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp"}`,
  });
  logger.info({
    event: "illu.edit_done",
    mode: input.mode,
    modelId: model.id,
    durationMs: Date.now() - startedAt,
  });
  return { imagePath: saved.path };
}
