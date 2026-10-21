/**
 * 文生图执行核心(M39 批④,自 cover-generate 执行段提取共用;cover 管线零
 * 改动):illustrate 角色绑定模型生图 → 逐张 uploadMedia 入库(sha1 去重),
 * 返回站内路径清单。计费口径同 cover:请求级失败落 failed 行(整批无图不计
 * 费),成功按张落 ok/degraded 行。
 * 同步执行:agent 工具调用内等待出图(云厂商 10-30s;agent 运行本就长驻,
 * 且插画是工具流内点状调用,不似 cover 另有编辑器路由消费场景,无需 BullMQ)。
 * M39 批③:参照图通道(referencePath 站内媒体路径 → mediaStorage 读字节 →
 * data URL 进 Seedream 原生 image 参数,出图向参照风格靠拢)——装载失败/超帽/
 * 格式不支持不阻塞生图,降级为无参照出图并把人话原因带回调用侧(agent 可见)。
 */
import path from "node:path";

import { logger } from "../logger";
import { uploadMedia } from "../media/service";
import { MEDIA_MIME_BY_EXT, mediaStorage, uploadsUrlToRel } from "../media/storage";

import { AI_PURPOSE_ILLUSTRATE } from "./constants";
import { AiAdminError, AiClientError } from "./errors";
import { decodeImageB64, downloadImage, generateImages, sniffImageMime } from "./image-client";
import { resolveAiModel } from "./resolver";
import { recordAiUsage } from "./usage-log";

/** 宽高比 → 分辨率映射(§13.9:宽高比是模型物理约束属机制参数,不携带内容
 * 语义;呈现形态由 agent 编排,经 prompt 表达)。横版与封面同档 16:9(公众号
 * 正文展示宽 ~900,1344 宽留缩略余量);竖版适配小红书 3:4;方图 1:1 兜底 */
export const ILLUSTRATE_ASPECT_SIZES: Record<string, string> = {
  "16:9": "1344x768",
  "3:4": "864x1152",
  "1:1": "1024x1024",
};

export type IllustrateAspect = keyof typeof ILLUSTRATE_ASPECT_SIZES;

/** 缺省宽高比(历史口径:横版 16:9) */
export const ILLUSTRATE_DEFAULT_ASPECT: IllustrateAspect = "16:9";

/** 单次调用张数帽:图文按小节点状生成,1 张为主、关键小节至多 3 张择优(按张计费) */
export const ILLUSTRATE_MAX_COUNT = 3;

/** 参照图字节帽(§13.11 决策 1;base64 后 ~1.33x 膨胀,官方单图 10MB 上限内自留量;
 * 上传侧 /api/writing-samples 同帽前置拦截,此处为执行期防御) */
export const ILLUSTRATE_REFERENCE_MAX_BYTES = 6 * 1024 * 1024;

/** 参照图白名单 mime(Seedream image 参数支持域;gif/svg 不收) */
const REFERENCE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** 参照图装载(站内媒体路径 → data URL);任一环失败返回人话原因,不抛——
 * 参照是增强不是硬依赖,生图照常进行(调用侧把原因带回 agent) */
async function loadReferenceDataUrl(
  referencePath: string,
): Promise<{ dataUrl: string } | { error: string }> {
  const rel = uploadsUrlToRel(referencePath);
  if (!rel) {
    return { error: "参照图路径不合法(仅支持站内媒体 /wp-content/uploads/ 路径)" };
  }
  const bytes = await mediaStorage.get(rel);
  if (!bytes || bytes.length === 0) {
    return { error: "参照图文件读取失败(可能已被删除):请到专题写作配置重新选择参照图" };
  }
  if (bytes.length > ILLUSTRATE_REFERENCE_MAX_BYTES) {
    return { error: "参照图超过 6MB 体积帽:请换更小的图" };
  }
  const mime = MEDIA_MIME_BY_EXT[path.extname(rel).toLowerCase()] ?? "";
  if (!REFERENCE_MIMES.has(mime)) {
    return { error: "参照图格式不支持(仅 png/jpeg/webp)" };
  }
  return { dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
}

export interface IllustrateImage {
  path: string;
  mime: string;
}

export interface GenerateIllustrationsInput {
  prompt: string;
  /** 张数(1..ILLUSTRATE_MAX_COUNT,越界收敛;默认 1) */
  n?: number;
  /** 宽高比(枚举守卫,越界回落缺省 16:9) */
  aspect?: string;
  /** 参照图站内媒体路径(M39 批③;/wp-content/uploads/ 前缀;装载失败降级无参照出图) */
  referencePath?: string;
}

export async function generateIllustrations(
  input: GenerateIllustrationsInput,
): Promise<{ images: IllustrateImage[]; referenceError: string | null }> {
  const model = await resolveAiModel(AI_PURPOSE_ILLUSTRATE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「插图配图(illustrate)」模型:先到 AI 配置完成任务绑定(需 OpenAI images/generations 兼容端点)",
    );
  }
  const n = Math.min(Math.max(input.n ?? 1, 1), ILLUSTRATE_MAX_COUNT);
  const size =
    ILLUSTRATE_ASPECT_SIZES[input.aspect ?? ""] ??
    ILLUSTRATE_ASPECT_SIZES[ILLUSTRATE_DEFAULT_ASPECT];
  // 参照图装载(§13.11 探针实证 Seedream 收 image 参数与 size 共存):失败降级
  // 无参照出图,人话原因带回调用侧(参照是增强不是硬依赖)
  let referenceDataUrl: string | undefined;
  let referenceError: string | null = null;
  if (input.referencePath) {
    const ref = await loadReferenceDataUrl(input.referencePath);
    if ("dataUrl" in ref) {
      referenceDataUrl = ref.dataUrl;
    } else {
      referenceError = ref.error;
      logger.warn({
        event: "illustrate.reference_load_failed",
        reason: ref.error,
        path: input.referencePath,
      });
    }
  }
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
      size,
      timeoutSec: model.timeoutSec,
      extraParams: model.extraParams,
      ...(referenceDataUrl ? { image: referenceDataUrl } : {}),
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
    referenceApplied: referenceDataUrl !== undefined,
  });
  return { images: out, referenceError };
}
