/**
 * 文生图执行核心(M39 批④,自 cover-generate 执行段提取共用;cover 管线零
 * 改动):illustrate 角色绑定模型生图 → 逐张 uploadMedia 入库(sha1 去重),
 * 返回站内路径清单。计费口径同 cover:请求级失败落 failed 行(整批无图不计
 * 费),成功按张落 ok/degraded 行。
 * 同步执行:agent 工具调用内等待出图(云厂商 10-30s;agent 运行本就长驻,
 * 且插画是工具流内点状调用,不似 cover 另有编辑器路由消费场景,无需 BullMQ)。
 */
import { logger } from "../logger";
import { uploadMedia } from "../media/service";

import { AI_PURPOSE_ILLUSTRATE } from "./constants";
import { AiAdminError, AiClientError } from "./errors";
import { decodeImageB64, downloadImage, generateImages, sniffImageMime } from "./image-client";
import { resolveAiModel } from "./resolver";
import { recordAiUsage } from "./usage-log";

/** 插画分辨率:与封面同档 16:9(公众号正文展示宽 ~900,1344 宽留缩略余量) */
export const ILLUSTRATE_IMAGE_SIZE = "1344x768";

/** 单次调用张数帽:插画按小节点状生成,1 张为主、关键小节至多 2 张择优(按张计费) */
export const ILLUSTRATE_MAX_COUNT = 2;

export interface IllustrateImage {
  path: string;
  mime: string;
}

export interface GenerateIllustrationsInput {
  prompt: string;
  /** 张数(1..ILLUSTRATE_MAX_COUNT,越界收敛;默认 1) */
  n?: number;
}

export async function generateIllustrations(
  input: GenerateIllustrationsInput,
): Promise<{ images: IllustrateImage[] }> {
  const model = await resolveAiModel(AI_PURPOSE_ILLUSTRATE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「插图配图(illustrate)」模型:先到 AI 配置完成任务绑定(需 OpenAI images/generations 兼容端点)",
    );
  }
  const n = Math.min(Math.max(input.n ?? 1, 1), ILLUSTRATE_MAX_COUNT);
  const startedAt = Date.now();
  let images;
  try {
    images = await generateImages({
      protocol: model.protocol,
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      apiKey: model.apiKey,
      prompt: input.prompt,
      n,
      size: ILLUSTRATE_IMAGE_SIZE,
      timeoutSec: model.timeoutSec,
      extraParams: model.extraParams,
    });
  } catch (e) {
    // 请求级失败(整批无图=不计费):落 failed 行供看板观测,错误原样上抛
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw e;
  }
  // 生图按张计费:逐张落行(status ok/degraded=备用),费用读时 = 行数 × price_per_image
  const durationMs = Date.now() - startedAt;
  for (let i = 0; i < images.length; i++) {
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      durationMs,
      status: model.source === "backup" ? "degraded" : "ok",
    });
  }
  const out: IllustrateImage[] = [];
  for (const img of images) {
    try {
      // b64 直解;url 形态服务端转存(免签名 URL 过期,不外链;同源才带鉴权,image-client 纪律)
      const bytes =
        "b64" in img
          ? decodeImageB64(img.b64)
          : await downloadImage(img.url, model.timeoutSec, {
              baseUrl: model.baseUrl,
              apiKey: model.apiKey,
            });
      const mime = sniffImageMime(bytes) ?? "image/webp";
      const saved = await uploadMedia({
        data: bytes,
        mime,
        filename: `illu-${Date.now().toString(36)}-${out.length + 1}.${
          mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp"
        }`,
      });
      out.push({ path: saved.path, mime });
    } catch (e) {
      // 单张失败(解码/白名单/落库)不废整批
      logger.warn({
        event: "illustrate.gen_image_failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (out.length === 0) {
    throw new AiClientError("business", "生图返回了图片但全部入库失败(查媒体服务与媒体卷日志)");
  }
  logger.info({
    event: "illustrate.gen_done",
    modelId: model.id,
    requested: n,
    generated: out.length,
    promptLen: input.prompt.length,
  });
  return { images: out };
}
