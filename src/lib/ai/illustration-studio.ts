/**
 * 配图工坊服务层(M40 批 B,arch/05 §4.7):版本链治理(根版本 get-or-create
 * / 编辑候选确认成版本/链回溯)+ 拆层入队(手动触发;并发防护=同版本已有
 * processing 组即拒,确定性 jobId 锚 groupId 天然唯一)+ 编辑器页面取数。
 * 纪律:generate_illustration 出图即登记根版本(免费 DB 行,agent 回执带
 * 工坊链接),拆层本身仍纯手动(计费动作由管理员在编辑器点按钮——M40 五决策)。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { ILLUSTRATION_JOB_DECOMPOSE, QUEUE_ILLUSTRATION_STUDIO, getQueue } from "../queue";

import { AiAdminError } from "./errors";

/** 编辑版 origin(三编辑回路;versions 路由 zod 与 labels.MODE_TO_ORIGIN 单源) */
export const EDIT_ORIGINS = ["text_edit", "erase", "redraw"] as const;
export type IllustrationEditOrigin = (typeof EDIT_ORIGINS)[number];

/** 版本产生方式(合法值应用层 Zod 管控;original=根版本,其余=三编辑回路) */
export const ILLUSTRATION_VERSION_ORIGINS = ["original", ...EDIT_ORIGINS] as const;
export type IllustrationVersionOrigin = (typeof ILLUSTRATION_VERSION_ORIGINS)[number];

/** 登记口(F13/F14 板面「来源」):agent=会话生图,studio=工坊直出;历史行 null 不显 */
export const ILLUSTRATION_SOURCES = ["agent", "studio"] as const;
export type IllustrationSource = (typeof ILLUSTRATION_SOURCES)[number];

/** 展示名派生:trim 后取前 40 字符(板卡名称行量级),空串回落 null(展示兜底「配图 #id」) */
export function deriveIllustrationName(prompt: string): string | null {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 40) : null;
}

/** normalized bbox 形态校验("x1 y1 x2 y2",各段 0-999 整数) */
export function isValidNormalizedBbox(bbox: string): boolean {
  const parts = bbox.trim().split(/\s+/);
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 999);
}

/** 根版本 get-or-create(同图复用同工坊;双击竞态最坏产两根,无害不设约束)。
 * 可选 name/source 仅在 create 时落(复用根不覆盖——首发登记即定型)。 */
export async function ensureStudioRoot(
  mediaPath: string,
  meta?: { name?: string | null; source?: IllustrationSource },
): Promise<{ versionId: bigint }> {
  const existing = await prisma.illustrationVersion.findFirst({
    where: { mediaPath, origin: "original" },
    select: { id: true },
  });
  if (existing) return { versionId: existing.id };
  const created = await prisma.illustrationVersion.create({
    data: {
      mediaPath,
      origin: "original",
      name: meta?.name ?? null,
      source: meta?.source ?? null,
    },
    select: { id: true },
  });
  logger.info({ event: "illu.studio_root_created", versionId: created.id });
  return { versionId: created.id };
}

/** 拆层入队(手动触发;改字后手动重拆同入口=新组):同版本已有 processing 组
 * → 409 人话拒(防重复计费双拆);jobId 锚 groupId 唯一,attempts=1 生图计费
 * 不自动重试(同 cover 口径) */
export async function enqueueDecompose(versionId: bigint): Promise<{ groupId: bigint }> {
  const version = await prisma.illustrationVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new AiAdminError("not_found", "工坊版本不存在");
  const processing = await prisma.illustrationLayerGroup.findFirst({
    where: { versionId, status: "processing" },
    select: { id: true },
  });
  if (processing) {
    throw new AiAdminError("conflict", "该版本已有拆层任务进行中,等完成后再试(拆层约 1-2 分钟)");
  }
  // 溯源列在入队时定格(与 resolver 选边同款:主力启用用主力,否则备用;无绑定 0)
  const binding = await prisma.aiTaskBinding.findUnique({
    where: { role: "illustrate" },
    select: {
      primary: { select: { id: true, enabled: true } },
      backup: { select: { id: true, enabled: true } },
    },
  });
  const modelId = binding?.primary?.enabled
    ? binding.primary.id
    : binding?.backup?.enabled
      ? binding.backup.id
      : 0;
  const group = await prisma.illustrationLayerGroup.create({
    data: { versionId, status: "processing", modelId },
    select: { id: true },
  });
  const jobId = `illu-decompose-${group.id}`; // jobId 禁冒号(与 cover 同口径)
  await getQueue(QUEUE_ILLUSTRATION_STUDIO).add(
    ILLUSTRATION_JOB_DECOMPOSE,
    { groupId: Number(group.id) },
    { jobId, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
  );
  logger.info({ event: "illu.decompose_enqueued", groupId: group.id, versionId });
  return { groupId: group.id };
}

/** 编辑候选确认成版本(预览态确认制的落笔步):parent 单链追加 */
export async function confirmEditVersion(
  parentVersionId: bigint,
  input: {
    imagePath: string;
    origin: Exclude<IllustrationVersionOrigin, "original">;
    instruction?: string;
    bbox?: string;
  },
): Promise<{ versionId: bigint }> {
  const parent = await prisma.illustrationVersion.findUnique({ where: { id: parentVersionId } });
  if (!parent) throw new AiAdminError("not_found", "父版本不存在(可能已被清理)");
  const created = await prisma.illustrationVersion.create({
    data: {
      mediaPath: input.imagePath,
      parentVersionId: parent.id,
      origin: input.origin,
      // 名称/来源随根继承(链上同名同源,板面 F13 卡与 F14 头部按链尾展示)
      name: parent.name,
      source: parent.source,
      editInstruction: input.instruction ?? null,
      editBbox: input.bbox ?? null,
    },
    select: { id: true },
  });
  logger.info({
    event: "illu.version_confirmed",
    versionId: created.id,
    parentId: parent.id,
    origin: input.origin,
  });
  return { versionId: created.id };
}

export interface StudioLayerView {
  id: number;
  zIndex: number;
  name: string;
  description: string | null;
  bbox: [number, number, number, number];
  mediaPath: string;
  visible: boolean;
}

export interface StudioGroupView {
  id: number;
  status: string;
  error: string | null;
  baseMediaPath: string | null;
  createdAt: string;
  layers: StudioLayerView[];
}

export interface StudioView {
  version: {
    id: number;
    mediaPath: string;
    origin: string;
    name: string | null;
    source: string | null;
    editInstruction: string | null;
    editBbox: string | null;
    createdAt: string;
  };
  /** 根→当前版本链(VersionStrip 渲染序) */
  chain: Array<{ id: number; origin: string; createdAt: string }>;
  /** 最新图层组(无拆层时 null;编辑器据此显式引导首次拆层) */
  latestGroup: StudioGroupView | null;
}

/** 编辑器页面取数:版本 + 根→当前链 + 最新组(含图层行,z 升序) */
export async function getStudioView(versionId: bigint): Promise<StudioView | null> {
  const version = await prisma.illustrationVersion.findUnique({ where: { id: versionId } });
  if (!version) return null;
  // 单链向上回溯(链深 = 编辑次数,量级 <20,逐级查询足够;上限 64 兜底手工
  // 数据 A↔B 互指的环——FK 不防逻辑环,无上限则单请求死循环,M48 批F)
  const chain: Array<{ id: bigint; origin: string; createdAt: Date }> = [];
  let cursor = version;
  while (true) {
    chain.unshift({ id: cursor.id, origin: cursor.origin, createdAt: cursor.createdAt });
    if (cursor.parentVersionId === null || chain.length >= 64) break;
    const parent = await prisma.illustrationVersion.findUnique({
      where: { id: cursor.parentVersionId },
    });
    if (!parent) break; // 悬挂 FK 兜底(理论不可达,FK 未设删除)
    cursor = parent;
  }
  const group = await prisma.illustrationLayerGroup.findFirst({
    where: { versionId },
    orderBy: { createdAt: "desc" },
    include: { layers: { orderBy: { zIndex: "asc" } } },
  });
  return {
    version: {
      id: Number(version.id),
      mediaPath: version.mediaPath,
      origin: version.origin,
      name: version.name,
      source: version.source,
      editInstruction: version.editInstruction,
      editBbox: version.editBbox,
      createdAt: version.createdAt.toISOString(),
    },
    chain: chain.map((c) => ({
      id: Number(c.id),
      origin: c.origin,
      createdAt: c.createdAt.toISOString(),
    })),
    latestGroup: group
      ? {
          id: Number(group.id),
          status: group.status,
          error: group.error,
          baseMediaPath: group.baseMediaPath,
          createdAt: group.createdAt.toISOString(),
          layers: group.layers.map((l) => ({
            id: Number(l.id),
            zIndex: l.zIndex,
            name: l.name,
            description: l.description,
            bbox: [l.bboxX1, l.bboxY1, l.bboxX2, l.bboxY2] as [number, number, number, number],
            mediaPath: l.mediaPath,
            visible: l.visible,
          })),
        }
      : null,
  };
}

/** 图层显隐切换(显隐组合的持久化;导出在编辑器前端画布完成) */
export async function setLayerVisible(layerId: bigint, visible: boolean): Promise<void> {
  const layer = await prisma.illustrationLayer.findUnique({
    where: { id: layerId },
    select: { id: true },
  });
  if (!layer) throw new AiAdminError("not_found", "图层不存在(可能已被重拆清理)");
  await prisma.illustrationLayer.update({ where: { id: layerId }, data: { visible } });
}
