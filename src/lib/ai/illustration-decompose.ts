/**
 * 配图工坊·图层拆分执行核心(M40 批 B,arch/05 §4.7):Seedream 同端点
 * layer_decomposition 拆层(手动触发,BullMQ 队列 illustration-studio 消费)
 * → 官方响应 URL 24h 过期前逐层下载转存站内媒体 → 图层组/图层行落库。
 * spike 实证契约(2026-10-22,产物 workspace/tmp/spike-illustration-studio/):
 * - POST {baseUrl}/images/generations,body {model, image(data URL),
 *   layer_decomposition: true, size: "2K", response_format: "url"}(prompt
 *   不传 = 自动拆层;~75s,故超时用专用常量不走模型 timeoutSec);
 * - 响应 data[] = 1 干净底板(z_index 0,output_format jpeg,无 bounding_box)
 *   + N 张透明 PNG 图层(各带 z_index/name/description/bounding_box,normalized
 *   0-999 与 absolute 双坐标);
 * - 底板=抠净元素的干净底(藏层即元素真消失);官方水印「AI生成」烙在底板上
 *   (导出恒带,合规自动闭环);图层是 bbox 区域高分重提(纵横比与 bbox 一致、
 *   尺寸非等比),合成必须按 normalized bbox 定位缩放。
 * 不走 generateImages/parseImagesResponse:拆层行携带图层元数据,行级解析契约
 * 不同(单源收口只覆盖 url/b64 图片形态);本模块自带请求与行解析,底板缺失/
 * 全层失败判失败,单层失败不废整组。计费口径:拆层按调用落 1 行 usage
 * (单价=模型 price_per_image,拆层单价待用户核实后于设置补录——M40 五决策)。
 */
import path from "node:path";

import { prisma } from "../db";
import { logger } from "../logger";
import { MEDIA_MIME_BY_EXT, mediaStorage, uploadsUrlToRel } from "../media/storage";
import { uploadMedia } from "../media/service";

import { AI_PURPOSE_ILLUSTRATE } from "./constants";
import { AiAdminError, AiClientError } from "./errors";
import { downloadImage, sniffImageMime } from "./image-client";
import { resolveAiModel } from "./resolver";
import { recordAiUsage } from "./usage-log";

/** 拆层请求超时(spike 实测 ~75s;2K 拆层是慢调用,不走模型 timeoutSec 的
 * 60s 常规档),图层下载转存同用此档 */
export const ILLUSTRATION_DECOMPOSE_TIMEOUT_SEC = 180;

/** 拆层请求数据 URL 源图帽(与参照图同帽 6MB;base64 后 ~1.33x 在官方 10MB 内) */
const SOURCE_MAX_BYTES = 6 * 1024 * 1024;

/** 响应行(拆层契约):底板行无 bounding_box,图层行齐备 */
interface DecomposeRow {
  b64_json?: unknown;
  url?: unknown;
  output_format?: unknown;
  z_index?: unknown;
  name?: unknown;
  description?: unknown;
  bounding_box?: {
    normalized?: unknown;
  };
}

export interface DecomposeJobData {
  groupId: number;
}

/** 站内媒体路径 → data URL(拆层输入;只收站内 /wp-content/uploads/ 路径——
 * 工坊锚定站内出图,不收外链);失败抛人话错(worker 落 group.error) */
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

/** 拆层响应行归一:行级脏数据跳过(单层失败不废整组);normalized 坐标
 * clamp 进 0-999 整数域(官方契约内,防御浮点) */
function parseDecomposeRow(row: DecomposeRow): {
  kind: "base" | "layer";
  url: string | null;
  b64: string | null;
  outputFormat: string;
  zIndex: number;
  name: string;
  description: string | null;
  bbox: [number, number, number, number] | null;
} {
  const url = typeof row.url === "string" && /^https:\/\//.test(row.url) ? row.url : null;
  const b64 = typeof row.b64_json === "string" && row.b64_json.length > 0 ? row.b64_json : null;
  const outputFormat = typeof row.output_format === "string" ? row.output_format : "png";
  const clamp = (v: unknown): number => Math.min(999, Math.max(0, Math.round(Number(v) || 0)));
  const norm = Array.isArray(row.bounding_box?.normalized) ? row.bounding_box.normalized : null;
  const bbox =
    norm && norm.length === 4
      ? ([clamp(norm[0]), clamp(norm[1]), clamp(norm[2]), clamp(norm[3])] as [
          number,
          number,
          number,
          number,
        ])
      : null;
  const isBase = bbox === null;
  return {
    kind: isBase ? "base" : "layer",
    url,
    b64,
    outputFormat,
    zIndex: isBase ? 0 : clamp(row.z_index),
    name:
      typeof row.name === "string" && row.name.trim() !== ""
        ? row.name.trim().slice(0, 200)
        : "未命名图层",
    description:
      typeof row.description === "string" && row.description.trim() !== ""
        ? row.description.trim().slice(0, 500)
        : null,
    bbox,
  };
}

function extFor(outputFormat: string): string {
  if (outputFormat === "jpeg" || outputFormat === "jpg") return "jpg";
  if (outputFormat === "webp") return "webp";
  return "png";
}

async function rowToBytes(
  row: ReturnType<typeof parseDecomposeRow>,
  model: { baseUrl: string | null; apiKey: string | null },
): Promise<Uint8Array> {
  const bytes =
    row.b64 !== null
      ? Buffer.from(
          row.b64.includes(",") ? row.b64.slice(row.b64.indexOf(",") + 1) : row.b64,
          "base64",
        )
      : await downloadImage(row.url as string, ILLUSTRATION_DECOMPOSE_TIMEOUT_SEC, {
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
        });
  if (bytes.length === 0) throw new AiClientError("business", "拆层返回了空图片数据");
  return bytes;
}

/** worker 消费入口:拆层 → 转存 → 落库。失败落 group.status=failed+人话 error
 * 后上抛(BullMQ 记 failedReason;入队侧 attempts=1 生图计费不自动重试) */
export async function illustrationDecomposeJob(
  data: DecomposeJobData,
): Promise<{ layers: number }> {
  const group = await prisma.illustrationLayerGroup.findUnique({
    where: { id: BigInt(data.groupId) },
    include: { version: true },
  });
  if (!group) throw new AiClientError("business", "拆层任务对应的图层组不存在(可能已被清理)");
  const model = await resolveAiModel(AI_PURPOSE_ILLUSTRATE);
  if (!model) {
    await failGroup(
      group.id,
      "未绑定或未启用「插图配图(illustrate)」模型:先到 AI 配置完成任务绑定",
    );
    throw new AiAdminError("disabled", "未绑定或未启用「插图配图(illustrate)」模型");
  }
  const startedAt = Date.now();
  let rows: ReturnType<typeof parseDecomposeRow>[];
  try {
    rows = await requestDecompose(group.version.mediaPath, model);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failGroup(group.id, message);
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw e;
  }
  const baseRow = rows.find((r) => r.kind === "base");
  const layerRows = rows.filter((r) => r.kind === "layer");
  if (!baseRow) {
    const message = "拆层响应缺干净底板行(契约漂移,检查供应商与模型 ID)";
    await failGroup(group.id, message);
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw new AiClientError("business", message);
  }
  // 底板转存(合成与画布预览的背景层;失败=整组失败)
  let baseMediaPath: string;
  try {
    const bytes = await rowToBytes(baseRow, model);
    const mime = sniffImageMime(bytes);
    const saved = await uploadMedia({
      data: bytes,
      mime,
      filename: `illu-base-${group.id}.${extFor(baseRow.outputFormat)}`,
    });
    baseMediaPath = saved.path;
  } catch (e) {
    const message = `底板转存失败:${e instanceof Error ? e.message : String(e)}`;
    await failGroup(group.id, message);
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw new AiClientError("business", message);
  }
  // 图层逐张转存落库(单层失败跳过不废整组,同 illustrate 出图纪律)
  let order = 0;
  for (const layer of layerRows) {
    try {
      if (!layer.bbox) continue; // kind==="layer" 蕴含 bbox 非空,守卫仅为类型收窄
      const bytes = await rowToBytes(layer, model);
      const mime = sniffImageMime(bytes);
      const saved = await uploadMedia({
        data: bytes,
        mime,
        filename: `illu-layer-${group.id}-${layer.zIndex}-${order}.${extFor(layer.outputFormat)}`,
      });
      await prisma.illustrationLayer.create({
        data: {
          groupId: group.id,
          zIndex: layer.zIndex,
          name: layer.name,
          description: layer.description,
          bboxX1: layer.bbox[0],
          bboxY1: layer.bbox[1],
          bboxX2: layer.bbox[2],
          bboxY2: layer.bbox[3],
          mediaPath: saved.path,
        },
      });
      order++;
    } catch (e) {
      logger.warn({
        event: "illu.layer_transfer_failed",
        groupId: group.id,
        zIndex: layer.zIndex,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (order === 0) {
    const message = "拆层返回了图层但全部转存失败(查媒体服务与媒体卷日志)";
    await failGroup(group.id, message);
    await recordAiUsage({
      role: AI_PURPOSE_ILLUSTRATE,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw new AiClientError("business", message);
  }
  await prisma.illustrationLayerGroup.update({
    where: { id: group.id },
    data: { status: "ready", baseMediaPath, error: null },
  });
  // 拆层按调用落 1 行 usage(拆层单价待用户核实后于设置补录——M40 五决策)
  await recordAiUsage({
    role: AI_PURPOSE_ILLUSTRATE,
    modelId: model.id,
    modelKey: model.modelId,
    durationMs: Date.now() - startedAt,
    status: model.source === "backup" ? "degraded" : "ok",
  });
  logger.info({
    event: "illu.decompose_done",
    groupId: group.id,
    versionId: group.versionId,
    layers: order,
    durationMs: Date.now() - startedAt,
  });
  return { layers: order };
}

async function failGroup(groupId: bigint, message: string): Promise<void> {
  await prisma.illustrationLayerGroup.update({
    where: { id: groupId },
    data: { status: "failed", error: message.slice(0, 500) },
  });
}

/** 拆层 HTTP 调用与行解析(契约注释见文件头;prompt 不传=自动拆层) */
async function requestDecompose(
  mediaPath: string,
  model: {
    protocol: string;
    baseUrl: string | null;
    modelId: string;
    apiKey: string | null;
    extraParams: Record<string, unknown>;
  },
): Promise<ReturnType<typeof parseDecomposeRow>[]> {
  if (model.protocol !== "openai") {
    throw new AiClientError(
      "unsupported",
      `拆层协议不支持(${model.protocol}):需 OpenAI images/generations 兼容端点`,
    );
  }
  if (!model.baseUrl) throw new AiClientError("unsupported", "生图 Base URL 未配置");
  const image = await loadImageDataUrl(mediaPath);
  // 保留键 model/image/layer_decomposition/size/response_format 恒覆盖模型扩展参数
  const extra = Object.fromEntries(Object.entries(model.extraParams).filter(([, v]) => v !== null));
  const body = {
    ...extra,
    model: model.modelId,
    image,
    layer_decomposition: true,
    size: "2K",
    response_format: "url",
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ILLUSTRATION_DECOMPOSE_TIMEOUT_SEC * 1000);
  let res: Response;
  try {
    res = await fetch(`${model.baseUrl.replace(/\/+$/, "")}/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(model.apiKey ? { authorization: `Bearer ${model.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new AiClientError(
      aborted ? "timeout" : "http",
      aborted
        ? `拆层超时(${ILLUSTRATION_DECOMPOSE_TIMEOUT_SEC}s)`
        : `拆层请求失败:${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AiClientError("http", `拆层 HTTP ${res.status}:${text.slice(0, 200)}`);
  }
  let bodyJson: unknown;
  try {
    bodyJson = await res.json();
  } catch {
    throw new AiClientError("business", "拆层响应不是 JSON");
  }
  const shell = bodyJson as { data?: unknown; error?: unknown };
  if (!Array.isArray(shell.data) || shell.data.length === 0) {
    const biz = typeof shell.error === "string" && shell.error.trim() !== "" ? shell.error : null;
    throw new AiClientError("business", biz ? `拆层失败:${biz}` : "拆层响应缺 data 数组(契约漂移)");
  }
  return (shell.data as DecomposeRow[]).map(parseDecomposeRow);
}
