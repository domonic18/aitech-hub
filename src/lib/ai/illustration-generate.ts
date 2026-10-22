/**
 * 贴图/工坊直出生成任务(M41):prompt → illustrate 绑定模型文生图 → 逐张登记
 * 工坊根版本(ensureStudioRoot)→ 可选回填贴图序列(pinId)。入队两口:
 * 工坊「新建配图」(无 pinId)与组装台「AI 生成贴图」(带 pinId)。
 * attempts=1 生图计费不自动重试(同拆层口径);完成无推送,调用方轮询取结果
 * (工坊列表 / 贴图详情)。缺省宽高比 3:4(小绿书竖版,异于 illustrate 缺省 16:9)。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, ILLUSTRATION_JOB_GENERATE, QUEUE_ILLUSTRATION_STUDIO } from "../queue";
import { PIN_IMAGES_MAX } from "../pins/constants";
import { AI_PURPOSE_ILLUSTRATE } from "./constants";
import {
  generateIllustrations,
  ILLUSTRATE_ASPECT_SIZES,
  ILLUSTRATE_MAX_COUNT,
} from "./illustrate-generate";
import { ensureStudioRoot } from "./illustration-studio";
import { resolveAiModel } from "./resolver";
import { AiAdminError } from "./errors";

export interface IllustrationGenerateJobData {
  prompt: string;
  aspect?: string;
  count?: number;
  /** 组装台入口携带:生成完成后自动挂到序列尾(超上限截断,编辑态才挂) */
  pinId?: string;
}

export interface IllustrationGenerateJobResult {
  versionIds: string[];
  attached: number;
  /** 参照图装载失败原因(降级无参照出图;参照是增强不是硬依赖) */
  referenceError: string | null;
}

/** 生成完成后回填贴图序列(编辑态才挂;超 20 张截断) */
async function attachGeneratedToPin(pinId: bigint, versionIds: bigint[]): Promise<number> {
  const pin = await prisma.contentPin.findUnique({
    where: { id: pinId },
    select: { status: true, _count: { select: { images: true } } },
  });
  if (!pin || (pin.status !== "draft" && pin.status !== "pending")) return 0;
  const room = PIN_IMAGES_MAX - pin._count.images;
  const toAttach = versionIds.slice(0, Math.max(0, room));
  if (toAttach.length === 0) return 0;
  const versions = await prisma.illustrationVersion.findMany({
    where: { id: { in: toAttach } },
    select: { id: true, mediaPath: true },
  });
  const pathById = new Map(versions.map((v) => [v.id, v.mediaPath]));
  const existing = await prisma.contentPinImage.count({ where: { pinId } });
  await prisma.contentPinImage.createMany({
    data: toAttach.map((versionId, i) => ({
      pinId,
      versionId,
      mediaPath: pathById.get(versionId) ?? "",
      sortOrder: existing + i,
    })),
  });
  return toAttach.length;
}

/** worker 消费:生图 → 登记工坊根版本 → 可选回填贴图 */
export async function illustrationGenerateJob(
  data: IllustrationGenerateJobData,
): Promise<IllustrationGenerateJobResult> {
  const aspect = data.aspect && ILLUSTRATE_ASPECT_SIZES[data.aspect] ? data.aspect : "3:4";
  const gen = await generateIllustrations({
    prompt: data.prompt,
    n: data.count,
    aspect,
  });
  const versionIds: bigint[] = [];
  for (const img of gen.images) {
    const { versionId } = await ensureStudioRoot(img.path);
    versionIds.push(versionId);
  }
  let attached = 0;
  if (data.pinId && versionIds.length > 0) {
    attached = await attachGeneratedToPin(BigInt(data.pinId), versionIds);
  }
  logger.info({
    event: "illu.generate_done",
    versions: versionIds.length,
    attached,
    pinId: data.pinId ?? null,
    aspect,
    referenceError: gen.referenceError,
  });
  return { versionIds: versionIds.map(String), attached, referenceError: gen.referenceError };
}

/**
 * 入队(工坊「新建配图」/ 组装台「AI 生成贴图」):前置核 illustrate 绑定模型
 * (job 内失败用户看不见,入队即 400 人话);宽高比越界回落 3:4。
 * jobId 时间戳唯一(非确定性 id,无 BullMQ 去重陷阱);attempts=1 计费不重试。
 */
export async function enqueueIllustrationGenerate(input: {
  prompt: string;
  aspect?: string;
  count?: number;
  pinId?: string;
}): Promise<{ jobId: string }> {
  const model = await resolveAiModel(AI_PURPOSE_ILLUSTRATE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「插图配图(illustrate)」模型:先到 AI 配置完成任务绑定",
    );
  }
  if (input.pinId) {
    const pin = await prisma.contentPin.findUnique({
      where: { id: BigInt(input.pinId) },
      select: { status: true, _count: { select: { images: true } } },
    });
    if (!pin) throw new AiAdminError("not_found", "贴图不存在");
    if (pin.status !== "draft" && pin.status !== "pending") {
      throw new AiAdminError("invalid", "已同步/已发布贴图不可加图,请先撤回待验收");
    }
    if (pin._count.images >= PIN_IMAGES_MAX) {
      throw new AiAdminError("invalid", `图片序列已达上限 ${PIN_IMAGES_MAX} 张`);
    }
  }
  const jobId = `illu-gen-${Date.now().toString(36)}`;
  await getQueue(QUEUE_ILLUSTRATION_STUDIO).add(
    ILLUSTRATION_JOB_GENERATE,
    {
      prompt: input.prompt,
      aspect: input.aspect && ILLUSTRATE_ASPECT_SIZES[input.aspect] ? input.aspect : "3:4",
      count: Math.min(Math.max(input.count ?? 1, 1), ILLUSTRATE_MAX_COUNT),
      ...(input.pinId ? { pinId: input.pinId } : {}),
    },
    { jobId, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
  );
  logger.info({
    event: "illu.generate_enqueued",
    jobId,
    pinId: input.pinId ?? null,
    aspect: input.aspect ?? "3:4",
  });
  return { jobId };
}
